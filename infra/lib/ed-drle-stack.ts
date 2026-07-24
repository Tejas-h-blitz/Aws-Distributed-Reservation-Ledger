import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

export class EdDrleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // 1. DYNAMODB TABLES
    // =========================================================================

    // Active Holds Table - Partition Key HoldID only, GSI for EventID & Status, Streams enabled
    const activeHoldsTable = new dynamodb.Table(this, "ActiveHoldsTable", {
      tableName: "ActiveHolds",
      partitionKey: { name: "HoldID", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      timeToLiveAttribute: "ExpirationTimestamp",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    activeHoldsTable.addGlobalSecondaryIndex({
      indexName: "EventIDStatusIndex",
      partitionKey: { name: "EventID", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "Status", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Idempotency Table - TTL enabled
    const idempotencyTable = new dynamodb.Table(this, "IdempotencyTable", {
      tableName: "Idempotency",
      partitionKey: { name: "IdempotencyKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expirationTime",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Inventory Fallback Table
    const inventoryCountersTable = new dynamodb.Table(this, "InventoryCountersTable", {
      tableName: "InventoryCounters",
      partitionKey: { name: "EventID", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // 2. DEAD LETTER QUEUES & TOPICS
    // =========================================================================
    const sagaDlq = new sqs.Queue(this, "SagaDLQ", {
      queueName: "ed-drle-saga-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    const slackAuditTopic = new sns.Topic(this, "SlackAuditTopic", {
      topicName: "ed-drle-slack-topic",
      displayName: "Reconciler low confidence & discrepancy Slack Topic",
    });

    // =========================================================================
    // 3. SECRETS MANAGER
    // =========================================================================
    const gatewaySecret = new secretsmanager.Secret(this, "PaymentGatewaySecret", {
      secretName: "payment-gateway-credentials",
      description: "API keys and auth configuration for the payment gateway client",
    });

    // =========================================================================
    // 4. LAMBDA FUNCTIONS (TypeScript code bundles)
    // =========================================================================
    const lambdaEnv = {
      AWS_ENDPOINT_URL: "http://localhost:4566",
      DB_HOST: "host.docker.internal", // PostgreSQL runs in local docker container
      DB_PORT: "5432",
      DB_USER: "postgres",
      DB_PASSWORD: "postgres",
      DB_NAME: "ledger_db",
      REDIS_HOST: "host.docker.internal", // Redis runs in local docker container
      REDIS_PORT: "6379",
      SNS_TOPIC_ARN: slackAuditTopic.topicArn,
    };

    // Hold creation Lambda (API gateway reserve)
    const holdLambda = new lambda.Function(this, "HoldLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/hold.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });
    activeHoldsTable.grantReadWriteData(holdLambda);
    idempotencyTable.grantReadWriteData(holdLambda);
    inventoryCountersTable.grantReadWriteData(holdLambda);

    // Stream Publisher Lambda
    const streamPublisherLambda = new lambda.Function(this, "StreamPublisherLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/stream-publisher.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });
    streamPublisherLambda.addEventSource(
      new lambdaEventSources.DynamoEventSource(activeHoldsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 5,
        retryAttempts: 3,
      })
    );

    // Payment Mock Lambda
    const paymentLambda = new lambda.Function(this, "PaymentLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/payment-mock.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });
    gatewaySecret.grantRead(paymentLambda);

    // Ledger Writer Lambda
    const ledgerWriterLambda = new lambda.Function(this, "LedgerWriterLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/ledger-writer.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });
    activeHoldsTable.grantReadWriteData(ledgerWriterLambda);

    // Compensate Lambda
    const compensateLambda = new lambda.Function(this, "CompensateLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/compensate.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });
    activeHoldsTable.grantReadWriteData(compensateLambda);
    inventoryCountersTable.grantReadWriteData(compensateLambda);

    // Reconciliation background Lambda (runs drift repair)
    const reconciliationLambda = new lambda.Function(this, "ReconciliationLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/reconciliation.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });
    activeHoldsTable.grantReadWriteData(reconciliationLambda);
    inventoryCountersTable.grantReadWriteData(reconciliationLambda);

    // Audit reconciler Lambda (supports task token pause)
    const auditReconcilerLambda = new lambda.Function(this, "AuditReconcilerLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/audit-reconciler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });
    slackAuditTopic.grantPublish(auditReconcilerLambda);

    // Settlement S3 Ingestion Lambda
    const settlementIngestionLambda = new lambda.Function(this, "SettlementIngestionLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "src/handlers/settlement-ingestion.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../..")),
      environment: lambdaEnv,
    });

    // =========================================================================
    // 5. STEP FUNCTIONS STATE MACHINE (Saga and Audit)
    // =========================================================================

    // 5.1 Saga State Machine
    const paymentTask = new tasks.LambdaInvoke(this, "PaymentTask", {
      lambdaFunction: paymentLambda,
      outputPath: "$.Payload",
    });

    const settleLedgerTask = new tasks.LambdaInvoke(this, "SettleLedgerTask", {
      lambdaFunction: ledgerWriterLambda,
      outputPath: "$.Payload",
    });

    const compensateTask = new tasks.LambdaInvoke(this, "CompensateTask", {
      lambdaFunction: compensateLambda,
      outputPath: "$.Payload",
    });

    const paymentSucceededChoice = new sfn.Choice(this, "PaymentSucceededChoice")
      .when(sfn.Condition.booleanEquals("$.success", true), settleLedgerTask)
      .otherwise(compensateTask);

    paymentTask.next(paymentSucceededChoice);

    const sagaStateMachine = new sfn.StateMachine(this, "SagaStateMachine", {
      stateMachineName: "ReservationSagaWorkflow",
      definitionBody: sfn.DefinitionBody.fromChainable(paymentTask),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(10),
    });
    sagaStateMachine.grantStartExecution(streamPublisherLambda);

    // 5.2 Audit State Machine (incorporating waitForTaskToken pause)
    const auditAuditTask = new tasks.LambdaInvoke(this, "AuditReconcileTask", {
      lambdaFunction: auditReconcilerLambda,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        taskToken: sfn.JsonPath.taskToken,
        settlementRecord: sfn.JsonPath.stringAt("$.settlementRecord"),
      }),
      outputPath: "$.status",
    });

    const auditStateMachine = new sfn.StateMachine(this, "AuditStateMachine", {
      stateMachineName: "AuditStateMachine",
      definitionBody: sfn.DefinitionBody.fromChainable(auditAuditTask),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.hours(24),
    });
    auditStateMachine.grantStartExecution(settlementIngestionLambda);
    auditReconcilerLambda.addEnvironment("AUDIT_STATE_MACHINE_ARN", auditStateMachine.stateMachineArn);
    settlementIngestionLambda.addEnvironment("AUDIT_STATE_MACHINE_ARN", auditStateMachine.stateMachineArn);

    // =========================================================================
    // 6. EVENTBRIDGE & TRIGGERS
    // =========================================================================
    const customEventBus = new events.EventBus(this, "EdDrleEventBus", {
      eventBusName: "ed-drle-bus",
    });
    streamPublisherLambda.addEnvironment("EVENT_BUS_NAME", customEventBus.eventBusName);

    // Rule: Route HoldCreated events to Saga Step Function
    const sagaRule = new events.Rule(this, "SagaTriggerRule", {
      eventBus: customEventBus,
      eventPattern: {
        source: ["ed.drle.reservation"],
        detailType: ["HoldCreated"],
      },
    });
    sagaRule.addTarget(new targets.SfnStateMachine(sagaStateMachine));

    // Scheduled Reconciliation (Drift repair scheduler every 5 minutes)
    const rule = new events.Rule(this, "ReconciliationSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });
    rule.addTarget(new targets.LambdaFunction(reconciliationLambda, {
      event: events.RuleTargetInput.fromObject({ EventID: "evt_concert_seat_1", TotalCapacity: 100 }),
    }));

    // =========================================================================
    // 7. S3 BUCKET
    // =========================================================================
    const settlementBucket = new s3.Bucket(this, "SettlementBucket", {
      bucketName: "ed-drle-settlements",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    settlementBucket.grantRead(settlementIngestionLambda);
    settlementBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(settlementIngestionLambda)
    );

    // =========================================================================
    // 8. API GATEWAY
    // =========================================================================
    const api = new apigateway.RestApi(this, "ReservationApi", {
      restApiName: "Reservation API Gateway",
      description: "Gateway for managing reservation holds and audit reviews.",
      deployOptions: { stageName: "prod" },
    });

    const reserveResource = api.root.addResource("reserve");
    reserveResource.addMethod("POST", new apigateway.LambdaIntegration(holdLambda));

    // =========================================================================
    // 9. CLOUDWATCH ALARMS
    // =========================================================================
    const holdLambdaErrorAlarm = new cloudwatch.Alarm(this, "HoldLambdaErrorAlarm", {
      metric: holdLambda.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "Fires if Hold Lambda experiences a execution error.",
    });

    const sagaSFNFailedAlarm = new cloudwatch.Alarm(this, "SagaSFNFailedAlarm", {
      metric: sagaStateMachine.metricFailed(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "Fires if a Saga Step Functions execution fails/aborts.",
    });

    const dlqDepthAlarm = new cloudwatch.Alarm(this, "DlqDepthAlarm", {
      metric: sagaDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "Fires if saga dead letter queue accumulates failed messages.",
    });

    // =========================================================================
    // 10. CLOUDWATCH DASHBOARD
    // =========================================================================
    const dashboard = new cloudwatch.Dashboard(this, "ReservationEngineDashboard", {
      dashboardName: "ED-DRLE-Operational-Dashboard",
    });

    // 10.1 Row 1: Alarm Status & Primary Operations Health
    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: "Operational Alarms Status",
        alarms: [holdLambdaErrorAlarm, sagaSFNFailedAlarm, dlqDepthAlarm],
        width: 8,
        height: 6,
      }),
      new cloudwatch.SingleValueWidget({
        title: "Latency Percentiles (Reserve Endpoint)",
        metrics: [
          api.metricLatency({ statistic: "p50", label: "p50 Latency" }),
          api.metricLatency({ statistic: "p95", label: "p95 Latency" }),
          api.metricLatency({ statistic: "p99", label: "p99 Latency" }),
        ],
        width: 16,
        height: 6,
      })
    );

    // 10.2 Row 2: API Gateway and Lambda Metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "API Gateway Requests & Errors",
        left: [api.metricCount({ label: "Total Requests", statistic: "Sum" })],
        right: [
          api.metricClientError({ label: "4xx Errors", statistic: "Sum" }),
          api.metricServerError({ label: "5xx Errors", statistic: "Sum" }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "Hold Lambda Execution Durations",
        left: [
          holdLambda.metricDuration({ statistic: "Average", label: "Avg Duration" }),
          holdLambda.metricDuration({ statistic: "p95", label: "p95 Duration" }),
        ],
        width: 12,
        height: 6,
      })
    );

    // 10.3 Row 3: Saga Executions and Cache vs Database Fallbacks
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Saga Execution Results",
        left: [
          sagaStateMachine.metricStarted({ label: "Sagas Started", statistic: "Sum" }),
          sagaStateMachine.metricSucceeded({ label: "Sagas Succeeded", statistic: "Sum" }),
          sagaStateMachine.metricFailed({ label: "Sagas Failed", statistic: "Sum" }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "Active Holds Table WCU / RCU Consumption",
        left: [
          activeHoldsTable.metricConsumedWriteCapacityUnits({ label: "Consumed WCU", statistic: "Sum" }),
          activeHoldsTable.metricConsumedReadCapacityUnits({ label: "Consumed RCU", statistic: "Sum" }),
        ],
        width: 12,
        height: 6,
      })
    );
  }
}

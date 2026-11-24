# ED-DRLE v2

ED-DRLE is a TypeScript learning project for reservation workflows, inventory
consistency, saga compensation, resilience, and observability. The repository
contains AWS CDK declarations and a local Express simulator; passing local
tests does **not** mean the AWS stack has been deployed or verified.

## Verified stack

- TypeScript / Node.js; CDK declares Node.js 20 Lambda runtime.
- AWS CDK v2 infrastructure source.
- Redis inventory, DynamoDB holds/fallback, and PostgreSQL ledger adapters are
  present in source. The PostgreSQL code uses process-local `pg.Pool`.
- The ordinary test suite uses in-memory adapters and an in-process saga
  simulator. It does not connect to Redis, PostgreSQL, DynamoDB Local,
  LocalStack, or AWS.

## Run locally

```powershell
npm ci
npm run build
npm test
npm run test:phase6
```

`npm test` starts the local API simulator and runs its integration pipelines.
`npm run test:phase6` runs focused RED metrics, trace propagation, injected
failure, bounded-retention, and exporter checks. `npm run test:otel` runs the
console-exporter test in isolation.

## Architecture and evidence

- [Current design and boundaries](docs/v2-design.md)
- [v1-to-v2 comparison](docs/v1-v2-comparison.md)
- [Benchmark report](docs/benchmark-report.md)
- [Resume worksheet—verified claims only](docs/resume-worksheet.md)
- [Phase 0 as-is v1 audit](docs/as-is-architecture.md)
- [Phase decisions](docs/decisions.md) and [failure evidence](docs/failures.md)

The committed performance results are labeled **local-in-memory**. The baseline
script measures 500 reserve requests in batches of 50 with local rate limiting
bypassed. It is not a Redis, PostgreSQL, DynamoDB, or AWS capacity result. Do
not use output from the ordinary test suite's load pipeline as a benchmark;
that output is not saved with `/bench` provenance.

## Known limits

- DynamoDB idempotency acquire/complete remains unimplemented; payload-bound
  idempotency is verified only with the memory adapter.
- Expiry reconciliation is a local/model behavior, not a durable Redis and
  DynamoDB consistency protocol. The Redis key TTL defaults to 24 hours.
- Compensation is replay-safe in the tested memory path, but the hold update
  and inventory return are not crash-atomic across stores.
- `pg.Pool` is process-local. The CDK stack does not define RDS or RDS Proxy.
- Fault injection is an in-memory model, not live network or AWS fault
  injection.
- OpenTelemetry console export is local and opt-in
  (`OTEL_CONSOLE_EXPORTER=true`). No remote collector, AWS export, deployed
  dashboard, or alert delivery has been verified.
- The stated 10,000 RPS target is unverified.

See [Phase 7 design](docs/v2-design.md) for the full evidence and limitation
breakdown before making deployment or scale claims.

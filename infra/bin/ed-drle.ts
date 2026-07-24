import * as cdk from "aws-cdk-lib";
import { EdDrleStack } from "../lib/ed-drle-stack";

const app = new cdk.App();
new EdDrleStack(app, "EdDrleStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || "000000000000",
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});

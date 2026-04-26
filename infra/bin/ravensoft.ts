#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RavensoftStack } from '../lib/ravensoft-stack';

const app = new cdk.App();

new RavensoftStack(app, 'RavensoftStack', {
  env: {
    // Set via CLI: cdk deploy --context account=123456789012 --context region=us-east-1
    // Or export CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION environment variables.
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1', // Must be us-east-1 for CloudFront ACM certificates
  },
  domainName: 'ravensoft.click',
});

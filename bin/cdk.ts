#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import * as cloudhsm from '../lib/cloudhsm/stack';
import * as kms from '../lib/kms/stack';

const app = new cdk.App();

new cloudhsm.Stack(app, 'Pix-Proxy-CloudHSM');
new cloudhsm.ClusterStack(app, 'Pix-Proxy-CloudHSM-Cluster');

const kmsLambdaStack = new kms.LambdaStack(app, 'Pix-Proxy-KMS-Lambda');
new kms.Stack(app, 'Pix-Proxy-KMS', {
    lambdaCode: kmsLambdaStack.proxy.lambdaCode
});



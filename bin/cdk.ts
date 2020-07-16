#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import * as cloudhsm from '../lib/cloudhsm/stack';

const app = new cdk.App();

new cloudhsm.Stack(app, 'Pix-Proxy-CloudHSM');
new cloudhsm.ClusterStack(app, 'Pix-Proxy-CloudHSM-Cluster');
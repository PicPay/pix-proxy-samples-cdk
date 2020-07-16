import * as cdk from "@aws-cdk/core";
import * as ecsPatterns from "@aws-cdk/aws-ecs-patterns";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";

export class ApplicationMultipleTargetGroupsFargateService extends ecsPatterns.ApplicationMultipleTargetGroupsFargateService {

    constructor(scope: cdk.Construct, id: string, props?: ecsPatterns.ApplicationMultipleTargetGroupsFargateServiceProps) {
        super(scope, id, props);
    }

    getTargetGroups(): elbv2.ApplicationTargetGroup[] {
        return this.targetGroups;
    }

}

export class NetworkMultipleTargetGroupsFargateService extends ecsPatterns.NetworkMultipleTargetGroupsFargateService {

    constructor(scope: cdk.Construct, id: string, props: ecsPatterns.NetworkMultipleTargetGroupsFargateServiceProps) {
        super(scope, id, props);
    }

    getTargetGroups(): elbv2.NetworkTargetGroup[] {
        return this.targetGroups;
    }

}
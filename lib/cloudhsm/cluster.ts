import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ecr from "@aws-cdk/aws-ecr";
import * as ecsPatterns from "@aws-cdk/aws-ecs-patterns";
import * as ssm from "@aws-cdk/aws-ssm";
import * as iam from "@aws-cdk/aws-iam";
import * as ecsFix from '../fix/ecs-fix';
import {Config} from "./config";
import {Base} from "./base";


export interface ClusterProps {
    readonly region: string;
    readonly account: string;
}

export class Cluster extends cdk.Construct {

    readonly props: ClusterProps;
    readonly vpc: ec2.IVpc;

    readonly cluster: ecs.Cluster;

    readonly fargateService: ecsPatterns.ApplicationMultipleTargetGroupsFargateService;

    constructor(scope: cdk.Construct, id: string, props: ClusterProps) {
        super(scope, id);

        this.props = props;

        this.vpc = this.importVpc();
        this.cluster = this.createCluster();
        this.fargateService = this.createFargateService();

        this.addAutoScaling();
        this.addPermissions();
    }

    private importVpc(): ec2.IVpc {
        let vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
            vpcId: cdk.Fn.importValue(Base.vpcIdExportName),
            availabilityZones: cdk.Fn.split(',', cdk.Fn.importValue(Base.vpcAZsExportName)),
            privateSubnetIds: cdk.Fn.split(',', cdk.Fn.importValue(Base.vpcPrivateSubnetIdsAZsExportName)),
            publicSubnetIds: cdk.Fn.split(',', cdk.Fn.importValue(Base.vpcPublicSubnetIdsAZsExportName))
        });

        return vpc;
    }

    private createCluster(): ecs.Cluster {
        let cluster = new ecs.Cluster(this, 'EcsCluster', {
            vpc: this.vpc
        });
        this.output('EcsClusterARN', cluster.clusterArn);

        return cluster;
    }

    private createFargateService(): ecsPatterns.ApplicationMultipleTargetGroupsFargateService {
        let repo = ecr.Repository.fromRepositoryName(this, 'EcrRepo', cdk.Fn.importValue(Base.repoNameExportName));
        const dictListener = 'DictListener';
        const spiListener = 'SpiListener';

        let fargateService = new ecsFix.ApplicationMultipleTargetGroupsFargateService(this, 'Service', {
            cluster: this.cluster,
            loadBalancers: [
                {
                    name: 'Pix-Proxy-CloudHSM-ALB',
                    publicLoadBalancer: false,
                    listeners: [
                        {
                            name: dictListener,
                            port: 8080
                        },
                        {
                            name: spiListener,
                            port: 9090
                        }
                    ]
                }
            ],
            targetGroups: [
                {
                    listener: dictListener,
                    containerPort: 8080
                },
                {
                    listener: spiListener,
                    containerPort: 9090
                }
            ],
            cpu: 512,
            memoryLimitMiB: 1024,
            taskImageOptions: {
                image: ecs.ContainerImage.fromEcrRepository(repo),
                containerName: 'Pix-Proxy-CloudHSM',
                containerPorts: [8080, 9090, 7070],
                secrets: this.loadSecrets()
            }
        });

        fargateService.getTargetGroups().forEach(tg => tg.configureHealthCheck({
            port: '7070',
            path: '/check',
            healthyThresholdCount: 3,
            unhealthyThresholdCount: 2
        }));

        fargateService.service.connections.allowFrom(fargateService.loadBalancer.connections, ec2.Port.tcp(7070));

        return fargateService;
    }

    private loadSecrets() {
        let hsmClusterId = ssm.StringParameter.fromStringParameterName(this, Config.hsmClusterId, Config.getParameterName(Config.hsmClusterId));
        let hsmCustomerCA = ssm.StringParameter.fromStringParameterName(this, Config.hsmCustomerCA, Config.getParameterName(Config.hsmCustomerCA));

        return {
            HSM_CLUSTER_ID: ecs.Secret.fromSsmParameter(hsmClusterId),
            HSM_CUSTOMER_CA: ecs.Secret.fromSsmParameter(hsmCustomerCA),
        }
    }

    private addAutoScaling() {
        const autoScalingGroup = this.fargateService.service.autoScaleTaskCount({
            minCapacity: 2,
            maxCapacity: 10
        });
        autoScalingGroup.scaleOnCpuUtilization('ServiceCpuScaling', {
            targetUtilizationPercent: 50,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });
    }

    private addPermissions() {

        this.fargateService.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
                `arn:aws:ssm:${this.props.region}:${this.props.account}:parameter${Config.parameterPrefix}`,
                `arn:aws:ssm:${this.props.region}:${this.props.account}:parameter${Config.parameterPrefix}*`,
                `arn:aws:secretsmanager:${this.props.region}:${this.props.account}:secret:${Config.parameterPrefix}*`,
            ],
            actions: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
                'ssm:GetParametersByPath',
                'ssm:DescribeParameters',
                'ssm:GetParameters',
                'ssm:GetParameter',
                'ssm:GetParameterHistory'
            ]
        }));

        this.fargateService.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: ["*"],
            actions: ["cloudhsm:DescribeClusters"]
        }));

        let dictAuditStream = ssm.StringParameter.fromStringParameterName(this, 'DictAuditName', Config.dictAuditStream);
        let spiAuditStream = ssm.StringParameter.fromStringParameterName(this, 'SpiAuditName', Config.spiAuditStream);

        this.fargateService.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
                `arn:aws:firehose:${this.props.region}:${this.props.account}:deliverystream/${dictAuditStream.stringValue}`,
                `arn:aws:firehose:${this.props.region}:${this.props.account}:deliverystream/${spiAuditStream.stringValue}`
            ],
            actions: [
                "firehose:PutRecord",
                "firehose:PutRecordBatch"
            ]
        }));

    }

    private output(id: string, value: string) {
        let output = new cdk.CfnOutput(this, id, {
            value: value
        });
        output.overrideLogicalId(id);
    }

}


import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ecr from "@aws-cdk/aws-ecr";
import * as ecsPatterns from "@aws-cdk/aws-ecs-patterns";
import * as iam from "@aws-cdk/aws-iam";
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';
import * as ecsFix from '../fix/ecs-fix';

export interface ClusterProps {
    readonly region: string;
    readonly account: string;

    readonly vpc: ec2.IVpc;

    readonly repoImportName: string;

    readonly zoneName: string;
    readonly zoneImportName: string;
}

export class Cluster extends cdk.Construct {

    readonly props: ClusterProps;
    readonly cluster: ecs.Cluster;
    readonly fargateService: ecsPatterns.NetworkMultipleTargetGroupsFargateService;

    constructor(scope: cdk.Construct, id: string, props: ClusterProps) {
        super(scope, id);

        this.props = props;
        this.cluster = this.createCluster();
        this.fargateService = this.createFargateService();

        this.addAutoScaling();
        this.createZoneRecord();
        this.addPermissions();
    }

    private createCluster(): ecs.Cluster {
        let cluster = new ecs.Cluster(this, 'EcsTestCluster', {
            vpc: this.props.vpc
        });
        this.output('EcsTestClusterARN', cluster.clusterArn);

        return cluster;
    }

    private createFargateService(): ecsPatterns.NetworkMultipleTargetGroupsFargateService {
        let repo = ecr.Repository.fromRepositoryName(this, 'EcrTestRepo', cdk.Fn.importValue(this.props.repoImportName));
        const dictListener = 'DictListenerTest';
        const spiListener = 'SpiListenerTest';

        let fargateService = new ecsFix.NetworkMultipleTargetGroupsFargateService(this, 'Service', {
            cluster: this.cluster,
            loadBalancers: [
                {
                    name: 'Pix-Proxy-Test-NLB',
                    publicLoadBalancer: false,
                    listeners: [
                        {
                            name: dictListener,
                            port: 8181
                        },
                        {
                            name: spiListener,
                            port: 9191
                        }
                    ]
                }
            ],
            targetGroups: [
                {
                    listener: dictListener,
                    containerPort: 8181
                },
                {
                    listener: spiListener,
                    containerPort: 9191
                }
            ],
            cpu: 512,
            memoryLimitMiB: 1024,
            taskImageOptions: {
                image: ecs.ContainerImage.fromEcrRepository(repo),
                containerName: 'Pix-Proxy-Test',
                containerPorts: [8181, 9191, 7171]
            }
        });

        fargateService.getTargetGroups().forEach(tg => tg.configureHealthCheck({
            port: '7171'
        }));

        fargateService.service.connections.allowFromAnyIpv4(ec2.Port.tcp(8181));
        fargateService.service.connections.allowFromAnyIpv4(ec2.Port.tcp(9191));
        fargateService.service.connections.allowFromAnyIpv4(ec2.Port.tcp(7171));

        return fargateService;
    }

    private addAutoScaling() {
        const autoScalingGroup = this.fargateService.service.autoScaleTaskCount({
            minCapacity: 2,
            maxCapacity: 10
        });
        autoScalingGroup.scaleOnCpuUtilization('ServiceTestCpuScaling', {
            targetUtilizationPercent: 50,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60),
        });
    }

    private createZoneRecord() {
        let zone = route53.PrivateHostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId: cdk.Fn.importValue(this.props.zoneImportName),
            zoneName: this.props.zoneName
        });

        let zoneRecord = new route53.ARecord(this, 'TestRecord', {
            zone: zone,
            recordName: 'test.pi',
            target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.fargateService.loadBalancer))
        });
    }

    private addPermissions() {

        this.fargateService.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
                `arn:aws:ssm:${this.props.region}:${this.props.account}:parameter/pix/proxy/`,
                `arn:aws:ssm:${this.props.region}:${this.props.account}:parameter/pix/proxy/*`,
            ],
            actions: [
                'ssm:GetParametersByPath',
                'ssm:DescribeParameters',
                'ssm:GetParameters',
                'ssm:GetParameter',
                'ssm:GetParameterHistory'
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
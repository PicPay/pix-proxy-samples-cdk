import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigateway from "@aws-cdk/aws-apigateway";
import * as iam from "@aws-cdk/aws-iam";
import * as ssm from "@aws-cdk/aws-ssm";
import { Base } from "./base";
import { Config } from "./config";

export interface ProxyProps {
    readonly region: string;
    readonly account: string;
}

export class Proxy extends cdk.Construct {

    readonly props: ProxyProps;
    readonly lambdaCode: lambda.CfnParametersCode;
    readonly vpc: ec2.IVpc;
    readonly vpcEndpoint: ec2.InterfaceVpcEndpoint;

    readonly spiLambdaFunction: lambda.Function;
    readonly spiApi: apigateway.LambdaRestApi;

    readonly dictLambdaFunction: lambda.Function;
    readonly dictApi: apigateway.LambdaRestApi;

    constructor(scope: cdk.Construct, id: string, props: ProxyProps) {
        super(scope, id);

        this.props = props;
        this.lambdaCode = lambda.Code.fromCfnParameters();
        this.vpc = this.importVpc();
        this.vpcEndpoint = this.createVpcEndpoint();

        this.spiLambdaFunction = this.createFunction(true);
        this.spiApi = this.createApi(this.spiLambdaFunction, 'spi');

        this.dictLambdaFunction = this.createFunction(false);
        this.dictApi = this.createApi(this.dictLambdaFunction, 'dict');
    }

    private importVpc(): ec2.IVpc {
        let vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
            vpcId: cdk.Fn.importValue(Base.vpcIdExportName),
            vpcCidrBlock: cdk.Fn.importValue(Base.vpcCidrExportName),
            availabilityZones: cdk.Fn.split(',', cdk.Fn.importValue(Base.vpcAZsExportName)),
            privateSubnetIds: cdk.Fn.split(',', cdk.Fn.importValue(Base.vpcPrivateSubnetIdsAZsExportName)),
            publicSubnetIds: cdk.Fn.split(',', cdk.Fn.importValue(Base.vpcPublicSubnetIdsAZsExportName))
        });

        return vpc;
    }

    private createVpcEndpoint(): ec2.InterfaceVpcEndpoint {
        let vpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'VpcEndpoint', {
            service: {
                name: `com.amazonaws.${this.props.region}.execute-api`,
                port: 443
            },
            vpc: this.vpc,
            open: true,
            privateDnsEnabled: true
        });

        return vpcEndpoint;
    }

    private createFunction(spiProxy: boolean): lambda.Function {
        let func = new lambda.Function(this, `${spiProxy ? 'Spi' : 'Dict'}Lambda`, {
            runtime: lambda.Runtime.PROVIDED,
            handler: 'none',
            code: this.lambdaCode,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(30),
            vpc: this.vpc,
            vpcSubnets: {
                subnets: this.vpc.privateSubnets
            },
            environment: {
                DISABLE_SIGNAL_HANDLERS: "true",
                PIX_SPI_PROXY: `${spiProxy}`
            },
            tracing: lambda.Tracing.ACTIVE
        });

        this.addPermissions(func, spiProxy);

        return func;
    }

    private addPermissions(func: lambda.Function, spiProxy: boolean) {

        func.addToRolePolicy(new iam.PolicyStatement({
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

        let auditStream = ssm.StringParameter.fromStringParameterName(this, `${spiProxy ? 'Spi' : 'Dict'}AuditStream`, spiProxy ? Config.spiAuditStream : Config.dictAuditStream);

        func.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
                `arn:aws:firehose:${this.props.region}:${this.props.account}:deliverystream/${auditStream.stringValue}`,
            ],
            actions: [
                "firehose:PutRecord",
                "firehose:PutRecordBatch"
            ]
        }));

        let signatureKeyId = ssm.StringParameter.fromStringParameterName(this, `${spiProxy ? 'Spi' : 'Dict'}SignatureKeyId`, Config.getParameterName(Config.SignatureKeyId));

        func.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: [
                `arn:aws:kms:${this.props.region}:${this.props.account}:key/${signatureKeyId.stringValue}`
            ],
            actions: [
                "kms:GetPublicKey",
                "kms:Verify",
                "kms:Sign"
            ]
        }));

    }

    private createApi(func: lambda.Function, name: string): apigateway.LambdaRestApi {
        let api = new apigateway.LambdaRestApi(this, `${name}Api`, {
            restApiName: `pix-proxy-kms-${name}`,
            handler: func,
            endpointConfiguration: {
                types: [apigateway.EndpointType.PRIVATE],
                vpcEndpoints: [this.vpcEndpoint]
            },
            policy: new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        principals: [new iam.AnyPrincipal],
                        actions: ['execute-api:Invoke'],
                        resources: ['execute-api:/*'],
                        effect: iam.Effect.DENY,
                        conditions: {
                            StringNotEquals: {
                                "aws:SourceVpce": this.vpcEndpoint.vpcEndpointId
                            }
                        }
                    }),
                    new iam.PolicyStatement({
                        principals: [new iam.AnyPrincipal],
                        actions: ['execute-api:Invoke'],
                        resources: ['execute-api:/*'],
                        effect: iam.Effect.ALLOW
                    })
                ]
            })
        });

        this.output(`${name}ApiUrl`, api.url)

        return api;
    }

    private output(id: string, value: string) {
        let output = new cdk.CfnOutput(this, id, {
            value: value
        });
        output.overrideLogicalId(id);
    }

}
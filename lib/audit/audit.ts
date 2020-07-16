import * as cdk from '@aws-cdk/core';
import * as s3 from "@aws-cdk/aws-s3";
import * as kinesisfirehose from "@aws-cdk/aws-kinesisfirehose";
import * as iam from "@aws-cdk/aws-iam";
import * as logs from "@aws-cdk/aws-logs";
import * as glue from "@aws-cdk/aws-glue";
import * as ssm from "@aws-cdk/aws-ssm";

export interface AuditProps {
    readonly region: string,
    readonly glueDatabaseName: string;
    readonly dictAuditStreamParam: string;
    readonly spiAuditStreamParam: string;
}

export class Audit extends cdk.Construct {

    private static readonly dict: string = 'Dict';
    private static readonly spi: string = 'Spi';

    private readonly props: AuditProps;

    readonly s3Bucket: s3.Bucket;
    readonly glueDatabase: glue.Database;

    constructor(scope: cdk.Construct, id: string, props: AuditProps) {
        super(scope, id);

        this.props = props;

        this.s3Bucket = this.createBucket();
        this.glueDatabase = this.createDatabase();

        this.createAuditStructure(Audit.dict, this.props.dictAuditStreamParam);
        this.createAuditStructure(Audit.spi, this.props.spiAuditStreamParam);

        this.createCrawler();
    }

    private createBucket(): s3.Bucket {
        let s3Bucket = new s3.Bucket(this, 'Bucket', {
            encryption: s3.BucketEncryption.KMS_MANAGED
        });
        this.output('S3BucketARN', s3Bucket.bucketArn, 'Pix-Proxy Audit S3 bucket ARN')

        return s3Bucket;
    }

    private createDatabase(): glue.Database {
        let glueDatabase = new glue.Database(this, 'AuditDatabase', {
            databaseName: this.props.glueDatabaseName
        });
        this.output('GlueDatabaseName', glueDatabase.databaseName, 'Pix-Proxy Audit Glue Database name');

        return glueDatabase;
    }

    private createCrawler() {
        let glueCrawlerRole = new iam.Role(this, 'GlueCrawlerRole', {
            assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
            managedPolicies: [
                {
                    managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole'
                }
            ]
        });

        let glueCrawlerPolicy = new iam.Policy(this, `GlueCrawlerRolePolicy`, {
            roles: [glueCrawlerRole],
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    resources: [
                        this.s3Bucket.bucketArn + "/log/dict*",
                        this.s3Bucket.bucketArn + "/log/spi*"
                    ],
                    actions: [
                        "s3:GetObject",
                        "s3:PutObject"
                    ]
                })
            ]
        });

        let glueCrawler = new glue.CfnCrawler(this, 'Pix-Proxy-Audit-Crawler', {
            role: glueCrawlerRole.roleArn,
            targets: {
                catalogTargets: [
                    {
                        databaseName: this.glueDatabase.databaseName,
                        tables: [Audit.dict.toLowerCase(), Audit.spi.toLowerCase()]
                    }
                ]
            },
            schemaChangePolicy: {
                updateBehavior: "UPDATE_IN_DATABASE",
                deleteBehavior: 'LOG'
            },
            schedule: {
                scheduleExpression: 'cron(10 * * * ? *)'
            }
        });

        glueCrawler.addDependsOn(glueCrawlerPolicy.node.defaultChild as cdk.CfnResource);
    }

    private createAuditStructure(id: string, streamParamName: string) {
        let idLowerCase = id.toLowerCase();

        /*
        Glue
         */

        let glueTable = new glue.Table(this, `${id}-AuditTable`, {
            tableName: idLowerCase,
            database: this.glueDatabase,
            bucket: this.s3Bucket,
            s3Prefix: `log/${idLowerCase}`,
            columns: [
                {name: 'request_date', type: glue.Schema.STRING},
                {name: 'request_method', type: glue.Schema.STRING},
                {name: 'request_path', type: glue.Schema.STRING},
                {name: 'request_header', type: glue.Schema.STRING},
                {name: 'request_body', type: glue.Schema.STRING},
                {name: 'response_status_code', type: glue.Schema.INTEGER},
                {name: 'response_signature_valid', type: glue.Schema.STRING},
                {name: 'response_header', type: glue.Schema.STRING},
                {name: 'response_body', type: glue.Schema.STRING}
            ],
            partitionKeys: [
                {name: 'year', type: glue.Schema.STRING},
                {name: 'month', type: glue.Schema.STRING},
                {name: 'day', type: glue.Schema.STRING},
                {name: 'hour', type: glue.Schema.STRING}
            ],
            dataFormat: glue.DataFormat.PARQUET
        });

        /*
        CloudWatch Logs
         */

        let firehoseLog = new logs.LogGroup(this, `${id}-FirehoseLog`, {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        let firehoseLogStream = new logs.LogStream(this, `${id}-FirehoseLogStream`, {
            logGroup: firehoseLog,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        /*
       IAM Role
        */

        let firehoseRole = new iam.Role(this, `${id}-FirehoseRole`, {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com')
        });

        let firehosePolicy = new iam.Policy(this, `${id}-FirehosePolicy`, {
            roles: [firehoseRole],
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    resources: [this.s3Bucket.bucketArn, this.s3Bucket.bucketArn + "/*"],
                    actions: [
                        "s3:AbortMultipartUpload",
                        "s3:GetBucketLocation",
                        "s3:GetObject",
                        "s3:ListBucket",
                        "s3:ListBucketMultipartUploads",
                        "s3:PutObject"
                    ]
                }),

                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    resources: [firehoseLog.logGroupArn],
                    actions: [
                        "logs:PutLogEvents"
                    ]
                }),

                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    resources: [
                        this.glueDatabase.catalogArn,
                        this.glueDatabase.databaseArn,
                        glueTable.tableArn
                    ],
                    actions: [
                        "glue:GetTable",
                        "glue:GetTableVersion",
                        "glue:GetTableVersions"
                    ]
                })

            ]
        });

        /*
        Kinesis Firehose
         */

        let firehose = new kinesisfirehose.CfnDeliveryStream(this, `${id}-Firehose`, {
            deliveryStreamType: 'DirectPut',
            extendedS3DestinationConfiguration: {
                bucketArn: this.s3Bucket.bucketArn,
                roleArn: firehoseRole.roleArn,
                prefix: `log/${idLowerCase}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/`,
                errorOutputPrefix: `error/${idLowerCase}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/!{firehose:error-output-type}`,
                bufferingHints: {
                    intervalInSeconds: 60,
                    sizeInMBs: 128
                },
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: firehoseLog.logGroupName,
                    logStreamName: firehoseLogStream.logStreamName
                },
                dataFormatConversionConfiguration: {
                    enabled: true,
                    outputFormatConfiguration: {
                        serializer: {
                            parquetSerDe: {
                                compression: 'SNAPPY'
                            }
                        }
                    },
                    inputFormatConfiguration: {
                        deserializer: {
                            openXJsonSerDe: {}
                        }
                    },
                    schemaConfiguration: {
                        region: this.props.region,
                        catalogId: this.glueDatabase.catalogId,
                        databaseName: this.glueDatabase.databaseName,
                        tableName: glueTable.tableName,
                        roleArn: firehoseRole.roleArn,
                        versionId: 'LATEST'
                    }
                }
            }
        });

        firehose.addDependsOn(firehosePolicy.node.defaultChild as cdk.CfnResource);

        /*
        Outputs
         */

        this.output(`${id}FirehoseStreamName`, firehose.ref, `Pix-Proxy Audit ${id} Firehose delivery stream ARN`);
        this.output(`${id}FirehoseLogGroupName`, firehoseLog.logGroupName, `Pix-Proxy Audit ${id} Firehose CloudWatch Log Group name`);
        this.output(`${id}FirehoseLogStreamName`, firehoseLogStream.logStreamName, `Pix-Proxy Audit ${id} Firehose CloudWatch Log Stream name`);
        this.output(`${id}GlueTableName`, glueTable.tableName,`Pix-Proxy Audit ${id} Glue Table name`);

        new ssm.StringParameter(this, `${id}-Firehose-StreamName-Param`, {
            parameterName: streamParamName,
            stringValue: firehose.ref
        });
    }

    private output(id: string, value: string, description?: string) {
        let output = new cdk.CfnOutput(this, id, {
            value: value,
            description: description
        });
        output.overrideLogicalId(id);
    }

}

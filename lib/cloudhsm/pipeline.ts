import * as cdk from '@aws-cdk/core';
import {Config} from "./config";
import * as codebuild from "@aws-cdk/aws-codebuild";
import * as codepipeline from "@aws-cdk/aws-codepipeline";
import * as codepipeline_actions from "@aws-cdk/aws-codepipeline-actions";
import {Base} from "./base";
import * as testBase from "../test/base";


export interface PipelineProps {
    readonly config: Config;
    readonly base: Base;
    readonly testBase: testBase.Base;
}

export class Pipeline extends cdk.Construct {

    private readonly props: PipelineProps;
    private readonly gitHubOwner: string = 'aws-samples';
    private readonly gitHubRepo: string = 'pix-proxy-samples';

    readonly pipeline: codepipeline.Pipeline;

    constructor(scope: cdk.Construct, id: string, props: PipelineProps) {
        super(scope, id);

        this.props = props;
        this.pipeline = this.createPipeline();
    }

    private createPipeline(): codepipeline.Pipeline {
        let sourceOutput = new codepipeline.Artifact();
        let containerImageBuildOutput = new codepipeline.Artifact('ContainerImageBuildOutput');
        let testContainerImageBuildOutput = new codepipeline.Artifact('TestContainerImageBuildOutput');

        let pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
            stages: [
                this.createSourceStage(sourceOutput),
                this.createBuildStage(sourceOutput, containerImageBuildOutput, testContainerImageBuildOutput),
                // this.createManualApprovalStage(),
                // this.createClusterStackDeployStage(sourceOutput)
            ]
        });

        let output = new cdk.CfnOutput(this, 'PipelineARN', {
            value: pipeline.pipelineArn
        });
        output.overrideLogicalId('PipelineARN');

        return pipeline;
    }

    private createSourceStage(output: codepipeline.Artifact): codepipeline.StageProps {
        const secret = cdk.SecretValue.secretsManager(this.props.config.gitHubSecret.secretArn, {
            jsonField: this.props.config.gitHubSecretTokenProperty
        });

        return {
            stageName: 'Source',
            actions: [
                new codepipeline_actions.GitHubSourceAction({
                    actionName: 'GitHub_Source',
                    trigger: codepipeline_actions.GitHubTrigger.NONE,
                    owner: this.gitHubOwner,
                    repo: this.gitHubRepo,
                    oauthToken: secret,
                    output: output
                })
            ]
        };
    }

    private createBuildStage(input: codepipeline.Artifact, output: codepipeline.Artifact, testOutput: codepipeline.Artifact): codepipeline.StageProps {
        let project = new codebuild.PipelineProject(this, 'ContainerImageBuild', {
            buildSpec: this.createBuildSpec(),
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
                privileged: true,
                environmentVariables: {
                    REPOSITORY_URI: {
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                        value: this.props.base.repo.repositoryUri
                    }
                }
            }
        });
        this.props.base.repo.grantPullPush(project.grantPrincipal);

        return {
            stageName: 'Build',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'ContainerImage_Build',
                    project: project,
                    input: input,
                    outputs: [output],
                }),
                this.props.testBase.createBuildAction(input, testOutput)
            ],
        }
    }

    private createBuildSpec(): codebuild.BuildSpec {
        return codebuild.BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    'runtime-versions': {
                        'java': 'corretto11'
                    },
                    commands: [
                        'java -version',
                        'mvn -version',
                        'aws --version'
                    ],
                },
                build: {
                    commands: [
                        'mvn -f proxy/pom.xml -pl core,cloudhsm/cavium,cloudhsm/proxy -DskipTests clean package',
                        '$(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)',
                        'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                        'docker build -f proxy/cloudhsm/proxy/src/main/docker/Dockerfile -t $REPOSITORY_URI:latest .',
                        'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$COMMIT_HASH'
                    ]
                },
                post_build: {
                    commands: [
                        'docker push $REPOSITORY_URI:latest',
                        'docker push $REPOSITORY_URI:$COMMIT_HASH',
                        'printf "[{\\"name\\":\\"pix-proxy-cloudhsm\\",\\"imageUri\\":\\"${REPOSITORY_URI}:latest\\"}]" > imagedefinitions.json'
                    ]
                }
            },
            artifacts: {
                files: [
                    'imagedefinitions.json'
                ]
            }
        });
    }

    private createManualApprovalStage(): codepipeline.StageProps {
        return {
            stageName: 'Approval',
            actions: [
                new codepipeline_actions.ManualApprovalAction({
                    actionName: 'ManualApproval',
                    additionalInformation: 'Attention! Continue only if you have imported all the necessary certificates!'
                })
            ]
        };
    }

    private createClusterStackDeployStage(input: codepipeline.Artifact): codepipeline.StageProps {
        return {
            stageName: 'ClusterStack',
            actions: [
                new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                    actionName: 'ClusterSatck_Deploy',
                    stackName: 'Pix-Proxy-CloudHSM-Cluster',
                    adminPermissions: true,
                    templatePath: input.atPath('cdk.out/Pix-Proxy-CloudHSM-Cluster.template.json')
                })
            ]
        };
    }

}
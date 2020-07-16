import * as cdk from "@aws-cdk/core";
import * as ecr from "@aws-cdk/aws-ecr";
import * as codepipeline_actions from "@aws-cdk/aws-codepipeline-actions";
import * as codebuild from "@aws-cdk/aws-codebuild";
import * as codepipeline from "@aws-cdk/aws-codepipeline";

export interface BaseProps {
    readonly repoExportName: string;
}

export class Base extends cdk.Construct {

    private readonly props: BaseProps;

    readonly repo: ecr.Repository;

    constructor(scope: cdk.Construct, id: string, props: BaseProps) {
        super(scope, id);

        this.props = props;
        this.repo = this.createEcrRepo();
    }

    private createEcrRepo(): ecr.Repository {
        let repo = new ecr.Repository(this, `RepoTest`);
        this.outputAndExport(`EcrRepoTest`, repo.repositoryName, this.props.repoExportName);
        return repo;
    }

    public createBuildAction(input: codepipeline.Artifact, output: codepipeline.Artifact): codepipeline_actions.CodeBuildAction {
        let project = new codebuild.PipelineProject(this, 'TestContainerImageBuild', {
            buildSpec: this.createBuildSpec(),
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
                privileged: true,
                environmentVariables: {
                    REPOSITORY_URI: {
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                        value: this.repo.repositoryUri
                    }
                }
            }
        });
        this.repo.grantPullPush(project.grantPrincipal);

        return new codepipeline_actions.CodeBuildAction({
                    actionName: 'TestContainerImage_Build',
                    project: project,
                    input: input,
                    outputs: [output],
                });
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
                        'mvn -f proxy/pom.xml -pl core,test -DskipTests clean package',
                        '$(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)',
                        'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                        'docker build -f proxy/test/src/main/docker/Dockerfile -t $REPOSITORY_URI:latest .',
                        'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$COMMIT_HASH'
                    ]
                },
                post_build: {
                    commands: [
                        'docker push $REPOSITORY_URI:latest',
                        'docker push $REPOSITORY_URI:$COMMIT_HASH',
                        'printf "[{\\"name\\":\\"pix-proxy-test\\",\\"imageUri\\":\\"${REPOSITORY_URI}:latest\\"}]" > imagedefinitions.json'
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

    private outputAndExport(id: string, value: string, exportName: string) {
        let output = new cdk.CfnOutput(this, id, {
            value: value,
            exportName: exportName
        });
        output.overrideLogicalId(id);
    }

}
import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import * as ecr from "@aws-cdk/aws-ecr";
import * as ecr_assets from "@aws-cdk/aws-ecr-assets";
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";
import * as rds from '@aws-cdk/aws-rds';
import * as iam from '@aws-cdk/aws-iam';


export class CdkAppStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // const containerImage = ecr.Repository.fromRepositoryName(this, "MyJDPRepo", "test-node-app");
    const dockerImage = new ecr_assets.DockerImageAsset(this, "MyJDPDockerImage", {
      directory: "/home/ec2-user/environment/node-app"
    });
    
    // The code that defines your stack goes here
    const vpc = new ec2.Vpc(this, "MyJDPVpc", {
      maxAzs: 3 // Default is all AZs in region
    });

    const cluster = new ecs.Cluster(this, "MyJDPCluster", {
      vpc: vpc
    });
    
    const dbinstance = new rds.DatabaseInstance(this, 'MyJDPRDSInstance', {
      engine: rds.DatabaseInstanceEngine.POSTGRES,
      // optional, defaults to m5.large
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.LARGE),
      masterUsername: 'syscdk',
      vpc,
      maxAllocatedStorage: 200,
    });

    // Create a load-balanced Fargate service and make it public
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "MyJDPFargateService", {
      cluster: cluster, // Required
      cpu: 512, // Default is 256
      desiredCount: 2, // Default is 1
      taskImageOptions: {
        // image: ecs.ContainerImage.fromEcrRepository(containerImage),
        image: ecs.ContainerImage.fromDockerImageAsset(dockerImage),
        containerPort: 8080
      },
      memoryLimitMiB: 2048, // Default is 512
      publicLoadBalancer: true // Default is false
    });
    
    fargateService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '10')
    
    fargateService.targetGroup.configureHealthCheck({
      healthyThresholdCount : 2,
      interval: cdk.Duration.seconds(15),
      timeout: cdk.Duration.seconds(5)
    });
    
    const getSecretsPolicy = new iam.PolicyStatement({
      resources: [dbinstance.secret!.secretArn],
      actions: ['secretsmanager:GetSecretValue'],
      effect: iam.Effect.ALLOW 
    });
    fargateService.taskDefinition.addToTaskRolePolicy(getSecretsPolicy);
    
    dbinstance.connections.allowFrom(fargateService.service, ec2.Port.tcp(5432), 'MyJDPTaskToDBInboundRule');
  }
}

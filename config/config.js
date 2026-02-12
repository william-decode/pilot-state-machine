// Pilot State Machine — DB and VPC connection (used by serverless.yml)
module.exports = {
  // RDS PostgreSQL
  DB_HOST: "pilot-db.cwtey80cgr7m.us-east-1.rds.amazonaws.com", // e.g., "pilot-db.xxxxx.us-east-1.rds.amazonaws.com"
  DB_PORT: "5432", // PostgreSQL default port
  DB_NAME: "postgres", // Database name (usually "postgres" is the default, not the RDS instance name)
  DB_USER: "postgres", // Database username
  DB_PASSWORD: "L1zN-waH)RUJEg<f<f3Ed(.pXHTX", // Database password
  
  // VPC Configuration (required for RDS access)
  // VPC ID: vpc-0d53893ac429d9ad2
  // RDS Security Group: sg-0b5ea54bb25bdda06 (default - allows connections from itself)
  // Using the same default security group for Lambda since it allows self-connections
  // For production, consider creating a dedicated security group for Lambda
  VPC_SECURITY_GROUP_ID: "sg-0b5ea54bb25bdda06", // Default security group (same as RDS)
  VPC_SUBNET_ID_1: "subnet-0ab80941e931d06cf", // First subnet ID from default VPC
  VPC_SUBNET_ID_2: "subnet-055244d84ed6500d2", // Second subnet ID (pick different AZ for HA if possible)

  // Lambda error notifications (SNS email subscriptions)
  ERROR_SUBSCRIBER_EMAIL: "william@decodelove.com",
  ERROR_SUBSCRIBER_EMAIL_2: "william@decodelove.com", // Add your email here to receive error alerts

  // Router topic ARN is built in serverless.yml as s3-event-router-<stage>-general
};
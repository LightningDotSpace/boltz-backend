# Build Docker Image

## DEV
Go to the project root directory and start the following build command:

`docker build --build-arg NODE_VERSION=22.14.0 --build-arg NODE_ENVIRONMENT=dev -f docker/boltz/Dockerfile -t dfxswiss/boltz-backend:dev .`

## PRD
Go to the project root directory and start the following build command:

`docker build --build-arg NODE_VERSION=22.14.0 --build-arg NODE_ENVIRONMENT=prd -f docker/boltz/Dockerfile -t dfxswiss/boltz-backend:prd .`

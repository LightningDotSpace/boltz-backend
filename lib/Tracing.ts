import { AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter';
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';
import { CompressionAlgorithm } from '@opentelemetry/otlp-exporter-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import process from 'process';
import packageJson from '../package.json';

const instrumentations = [
  new HttpInstrumentation(),
  new ExpressInstrumentation(),
  new GrpcInstrumentation(),
  new PgInstrumentation(),
  new WinstonInstrumentation(),
];

type TelemetryConfig = {
  network: string;
  otlpEndpoint?: string;
  azureConnectionString?: string;
};

class Tracing {
  public tracer = trace.getTracer(packageJson.name);

  private sdk?: NodeSDK;

  /**
   * Initialize OpenTelemetry with Azure Monitor and/or OTLP export
   *
   * Priority:
   * 1. Azure Monitor (if azureConnectionString provided)
   * 2. OTLP gRPC (if otlpEndpoint provided)
   */
  public init = (config: TelemetryConfig) => {
    const { network, otlpEndpoint, azureConnectionString } = config;

    let traceExporter: SpanExporter;

    if (azureConnectionString) {
      // Azure Monitor exporter (sends to Application Insights)
      traceExporter = new AzureMonitorTraceExporter({
        connectionString: azureConnectionString,
      });
    } else if (otlpEndpoint) {
      // Generic OTLP gRPC exporter (for Grafana Tempo, Jaeger, etc.)
      traceExporter = new OTLPTraceExporter({
        url: otlpEndpoint,
        concurrencyLimit: 2_000,
        compression: CompressionAlgorithm.GZIP,
      });
    } else {
      // No exporter configured - traces will be captured but not exported
      return;
    }

    this.sdk = new NodeSDK({
      instrumentations,
      resource: resourceFromAttributes({
        ['process.pid']: process.pid,
        ['service.version']: packageJson.version,
        ['service.name']: `boltz-backend-${network}`,
        ['deployment.environment']: network,
      }),
      traceExporter,
    });

    this.sdk.start();
  };

  /**
   * Legacy init method for backward compatibility
   * @deprecated Use init(config) instead
   */
  public initLegacy = (endpoint: string, network: string) => {
    this.init({ network, otlpEndpoint: endpoint });
  };

  public stop = async () => {
    await this.sdk?.shutdown();
  };
}

export default new Tracing();
export type { TelemetryConfig };

import { status } from '@grpc/grpc-js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Logger from '../../../lib/Logger';
import { ClientStatus } from '../../../lib/consts/Enums';
import LndClient from '../../../lib/lightning/LndClient';

describe('LndClient', () => {
  let certDir: string;
  let client: LndClient;

  beforeAll(() => {
    certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lnd-client-spec-'));
    fs.writeFileSync(path.join(certDir, 'tls.cert'), 'certificate');
  });

  afterAll(() => {
    fs.rmSync(certDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    client = new LndClient(Logger.disabledLogger, 'BTC', {
      host: '127.0.0.1',
      port: 10009,
      certpath: path.join(certDir, 'tls.cert'),
      macaroonpath: '',
      maxPaymentFeeRatio: 0.01,
    });
  });

  afterEach(() => {
    client['clearReconnectTimer']();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('handleSubscriptionError', () => {
    test('should ignore deliberate local cancels', async () => {
      client.setClientStatus(ClientStatus.Connected);
      const reconnect = jest
        .spyOn(client as any, 'reconnect')
        .mockResolvedValue(undefined);
      const scheduleReconnect = jest.spyOn(client as any, 'scheduleReconnect');

      await client['handleSubscriptionError']('peer event', {
        code: status.CANCELLED,
        details: 'Cancelled on client',
      });

      expect(reconnect).not.toHaveBeenCalled();
      expect(scheduleReconnect).not.toHaveBeenCalled();
      expect(client.isConnected()).toEqual(true);
    });

    test('should reconnect on genuine errors while connected', async () => {
      client.setClientStatus(ClientStatus.Connected);
      const reconnect = jest
        .spyOn(client as any, 'reconnect')
        .mockResolvedValue(undefined);

      await client['handleSubscriptionError']('peer event', {
        code: status.UNAVAILABLE,
        details: 'Connection dropped',
      });

      expect(reconnect).toHaveBeenCalledTimes(1);
    });

    test('should schedule a reconnect on genuine errors while disconnected', async () => {
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      await client['handleSubscriptionError']('channel event', {
        code: status.UNAVAILABLE,
        details: 'Connection dropped',
      });

      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconnect', () => {
    test('should not leak a pending reconnect timer when reconnecting fails', async () => {
      jest.useFakeTimers();
      jest
        .spyOn(client as any, 'getInfo')
        .mockRejectedValue(new Error('connection refused'));

      client['scheduleReconnect']();
      expect(jest.getTimerCount()).toEqual(1);

      await client['reconnect']();
      expect(jest.getTimerCount()).toEqual(1);
    });
  });
});

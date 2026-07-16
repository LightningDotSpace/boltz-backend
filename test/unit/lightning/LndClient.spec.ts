import type { ClientReadableStream } from '@grpc/grpc-js';
import { status } from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Logger from '../../../lib/Logger';
import { ClientStatus } from '../../../lib/consts/Enums';
import LndClient from '../../../lib/lightning/LndClient';
import type * as lndrpc from '../../../lib/proto/lnd/rpc_pb';

describe('LndClient', () => {
  let certDir: string;
  let client: LndClient;

  const activeStream = <T>() => ({}) as unknown as ClientReadableStream<T>;

  const fakeStream = () => {
    const stream = new EventEmitter() as any;
    stream.cancel = jest.fn();
    return stream;
  };

  // The error handlers are async, so their reaction lands a microtask later
  const flush = () => new Promise(process.nextTick);

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
    test('should ignore errors of subscriptions that were replaced', async () => {
      client.setClientStatus(ClientStatus.Connected);
      const scheduleReconnect = jest.spyOn(client as any, 'scheduleReconnect');

      // The stream that errored is not the one the client currently holds,
      // which is what resubscribing and disconnecting leave behind
      client['peerEventSubscription'] = activeStream<lndrpc.PeerEvent>();

      await client['handleSubscriptionError'](
        'peer event',
        activeStream<lndrpc.PeerEvent>(),
        {
          code: status.CANCELLED,
          details: 'Cancelled on client',
        },
      );

      expect(scheduleReconnect).not.toHaveBeenCalled();
      expect(client.isConnected()).toEqual(true);
    });

    test('should reconnect when the active subscription is cancelled remotely', async () => {
      client.setClientStatus(ClientStatus.Connected);
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      // grpc-js reports a remote peer cancelling an active stream with the same
      // status code as a local cancel, so the code alone must not silence it
      const subscription = activeStream<lndrpc.PeerEvent>();
      client['peerEventSubscription'] = subscription;

      await client['handleSubscriptionError']('peer event', subscription, {
        code: status.CANCELLED,
        details: 'Call cancelled',
      });

      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
      expect(client.isConnected()).toEqual(false);
    });

    test('should reconnect through the timer guard instead of directly', async () => {
      client.setClientStatus(ClientStatus.Connected);
      const reconnect = jest
        .spyOn(client as any, 'reconnect')
        .mockResolvedValue(undefined);
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      const subscription = activeStream<lndrpc.ChannelEventUpdate>();
      client['channelEventSubscription'] = subscription;

      await client['handleSubscriptionError']('channel event', subscription, {
        code: status.UNAVAILABLE,
        details: 'Connection dropped',
      });

      // Calling reconnect directly would bypass the guard and resubscribe
      // without a backoff
      expect(reconnect).not.toHaveBeenCalled();
      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    });

    test('should emit and mark the client disconnected while connected', async () => {
      client.setClientStatus(ClientStatus.Connected);
      jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      const emit = jest.spyOn(client, 'emit');
      const subscription = activeStream<lndrpc.PeerEvent>();
      client['peerEventSubscription'] = subscription;

      await client['handleSubscriptionError']('peer event', subscription, {
        code: status.UNAVAILABLE,
        details: 'Connection dropped',
      });

      expect(emit).toHaveBeenCalledWith('subscription.error', 'peer event');
      expect(client.isDisconnected()).toEqual(true);
    });

    test('should schedule a reconnect on genuine errors while disconnected', async () => {
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      const subscription = activeStream<lndrpc.ChannelEventUpdate>();
      client['channelEventSubscription'] = subscription;

      await client['handleSubscriptionError']('channel event', subscription, {
        code: status.UNAVAILABLE,
        details: 'Connection dropped',
      });

      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribePeerEvents', () => {
    test('should only react to errors of the stream it is currently on', async () => {
      const streams = [fakeStream(), fakeStream()];
      let created = 0;
      client['lightning'] = {
        subscribePeerEvents: jest.fn(() => streams[created++]),
      } as any;

      client.setClientStatus(ClientStatus.Connected);
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      client['subscribePeerEvents']();
      client['subscribePeerEvents']();

      expect(streams[0].cancel).toHaveBeenCalledTimes(1);

      // The replaced stream reporting our own cancel must not reconnect
      streams[0].emit('error', {
        code: status.CANCELLED,
        details: 'Cancelled on client',
      });
      await flush();

      expect(scheduleReconnect).not.toHaveBeenCalled();
      expect(client.isConnected()).toEqual(true);

      // The stream the client is actually on must
      streams[1].emit('error', {
        code: status.UNAVAILABLE,
        details: 'Connection dropped',
      });
      await flush();

      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    });

    test('should not reconnect when disconnect cancelled the subscription', async () => {
      const stream = fakeStream();
      client['lightning'] = {
        subscribePeerEvents: jest.fn(() => stream),
        close: jest.fn(),
      } as any;

      client.setClientStatus(ClientStatus.Connected);
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      client['subscribePeerEvents']();
      client.disconnect();

      stream.emit('error', {
        code: status.CANCELLED,
        details: 'Cancelled on client',
      });
      await flush();

      expect(scheduleReconnect).not.toHaveBeenCalled();
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

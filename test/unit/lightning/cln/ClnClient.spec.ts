import type { ClientReadableStream } from '@grpc/grpc-js';
import { credentials, status } from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import Logger from '../../../../lib/Logger';
import { ClientStatus } from '../../../../lib/consts/Enums';
import ClnClient from '../../../../lib/lightning/cln/ClnClient';

// Reading and parsing the TLS certificates is environment setup, not part of
// the reconnect behaviour under test
jest.mock('../../../../lib/lightning/cln/Types', () => ({
  ...jest.requireActual('../../../../lib/lightning/cln/Types'),
  createSsl: jest.fn(() => credentials.createInsecure()),
}));

describe('ClnClient', () => {
  let client: ClnClient;

  const activeStream = () =>
    ({}) as unknown as ClientReadableStream<unknown> as any;

  const fakeStream = () => {
    const stream = new EventEmitter() as any;
    stream.cancel = jest.fn();
    return stream;
  };

  // The error handler is async, so its reaction lands a microtask later
  const flush = () => new Promise(process.nextTick);

  const certs = {
    rootCertPath: 'ca.pem',
    privateKeyPath: 'client-key.pem',
    certChainPath: 'client.pem',
  };

  beforeEach(() => {
    client = new ClnClient(Logger.disabledLogger, 'BTC', {
      host: '127.0.0.1',
      port: 9736,
      maxPaymentFeeRatio: 0.01,
      ...certs,
      hold: {
        host: '127.0.0.1',
        port: 9292,
        ...certs,
      },
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
      client['trackAllSubscription'] = activeStream();

      await client['handleSubscriptionError'](
        'track hold invoices',
        activeStream(),
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
      const subscription = activeStream();
      client['trackAllSubscription'] = subscription;

      await client['handleSubscriptionError'](
        'track hold invoices',
        subscription,
        {
          code: status.CANCELLED,
          details: 'Call cancelled',
        },
      );

      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
      expect(client.isConnected()).toEqual(false);
    });

    test('should emit and mark the client disconnected while connected', async () => {
      client.setClientStatus(ClientStatus.Connected);
      jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      const emit = jest.spyOn(client, 'emit');
      const subscription = activeStream();
      client['trackAllSubscription'] = subscription;

      await client['handleSubscriptionError'](
        'track hold invoices',
        subscription,
        {
          code: status.UNAVAILABLE,
          details: 'Connection dropped',
        },
      );

      expect(emit).toHaveBeenCalledWith(
        'subscription.error',
        'track hold invoices',
      );
      expect(client.isDisconnected()).toEqual(true);
    });

    test('should schedule a reconnect on genuine errors', async () => {
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      const subscription = activeStream();
      client['trackAllSubscription'] = subscription;

      await client['handleSubscriptionError'](
        'track hold invoices',
        subscription,
        {
          code: status.UNAVAILABLE,
          details: 'Connection dropped',
        },
      );

      expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribeTrackHoldInvoices', () => {
    test('should only react to errors of the stream it is currently on', async () => {
      const streams = [fakeStream(), fakeStream()];
      let created = 0;
      client['holdClient'] = {
        trackAll: jest.fn(() => streams[created++]),
      } as any;

      client.setClientStatus(ClientStatus.Connected);
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      client.subscribeTrackHoldInvoices();
      client.subscribeTrackHoldInvoices();

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
      client['holdClient'] = {
        trackAll: jest.fn(() => stream),
        close: jest.fn(),
      } as any;

      client.setClientStatus(ClientStatus.Connected);
      const scheduleReconnect = jest
        .spyOn(client as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      client.subscribeTrackHoldInvoices();
      client.disconnect();

      stream.emit('error', {
        code: status.CANCELLED,
        details: 'Cancelled on client',
      });
      await flush();

      expect(scheduleReconnect).not.toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    test('should clear the retry timer once a retried connect succeeds', async () => {
      jest.useFakeTimers();
      jest
        .spyOn(client as any, 'getInfo')
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValue({});

      // The first attempt fails and arms the retry timer
      await client.connect();
      expect(client.isDisconnected()).toEqual(true);
      expect(client['reconnectionTimer']).toBeDefined();

      // The armed timer fires and reconnects successfully
      await jest.advanceTimersByTimeAsync(5000);

      expect(client.isConnected()).toEqual(true);

      // A fired handle left behind here would make scheduleReconnect, the only
      // recovery path of this client, a no-op for the rest of the process
      expect(client['reconnectionTimer']).toBeUndefined();
    });

    test('should keep scheduling reconnects after a retried connect', async () => {
      jest.useFakeTimers();
      jest
        .spyOn(client as any, 'getInfo')
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValue({});

      await client.connect();
      await jest.advanceTimersByTimeAsync(5000);
      expect(client.isConnected()).toEqual(true);

      client['scheduleReconnect']();

      expect(client['reconnectionTimer']).toBeDefined();
      expect(jest.getTimerCount()).toEqual(1);
    });
  });
});

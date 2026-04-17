import { describe, it, expect, vi } from 'vitest';
import { AxlEmitter, processListeners, PriorityListener } from '../src/index';

// ---------------------------------------------------------------------------
// processListeners — standalone util
// ---------------------------------------------------------------------------

describe('processListeners', () => {
    it('calls callbacks in descending priority order', async () => {
        const order: number[] = [];
        const listeners: PriorityListener[] = [
            { callback: () => { order.push(1); }, priority: 1 },
            { callback: () => { order.push(30); }, priority: 30 },
            { callback: () => { order.push(10); }, priority: 10 },
        ];
        await processListeners(listeners);
        expect(order).toEqual([30, 10, 1]);
    });

    it('awaits async callbacks sequentially', async () => {
        const log: string[] = [];
        const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

        const listeners: PriorityListener[] = [
            {
                callback: async () => { await delay(10); log.push('slow'); },
                priority: 10,
            },
            {
                callback: async () => { log.push('fast'); },
                priority: 0,
            },
        ];

        await processListeners(listeners);
        // 'slow' runs first (higher priority) and is awaited before 'fast'
        expect(log).toEqual(['slow', 'fast']);
    });

    it('removes once listeners before invoking them', async () => {
        const called: number[] = [];
        const listeners: PriorityListener[] = [
            { callback: () => { called.push(1); }, priority: 0, once: true },
            { callback: () => { called.push(2); }, priority: 0 },
        ];
        await processListeners(listeners);
        expect(called).toEqual([1, 2]);
        // once listener must be gone
        expect(listeners.some(l => l.once)).toBe(false);
        // persistent listener remains
        expect(listeners).toHaveLength(1);
    });

    it('exits early when array is emptied mid-flight', async () => {
        const called: number[] = [];
        const listeners: PriorityListener[] = [];

        listeners.push({
            priority: 10,
            callback: () => {
                called.push(1);
                // empty the shared array — simulates offAll
                listeners.length = 0;
            },
        });
        listeners.push({
            priority: 0,
            callback: () => { called.push(2); },
        });

        await processListeners(listeners);
        expect(called).toEqual([1]);
    });

    it('resolves immediately with empty array', async () => {
        await expect(processListeners([])).resolves.toBeUndefined();
    });

    it('propagates errors thrown inside callbacks', async () => {
        const listeners: PriorityListener[] = [
            { callback: () => { throw new Error('boom'); }, priority: 0 },
        ];
        await expect(processListeners(listeners)).rejects.toThrow('boom');
    });
});

// ---------------------------------------------------------------------------
// AxlEmitter — class API
// ---------------------------------------------------------------------------

describe('AxlEmitter', () => {
    it('emits to registered listeners with arguments', async () => {
        const emitter = new AxlEmitter();
        const received: number[] = [];
        emitter.on('test', (a: number, b: number) => { received.push(a + b); });
        await emitter.emit('test', 3, 7);
        expect(received).toEqual([10]);
    });

    it('resolves emit on an event with no listeners', async () => {
        const emitter = new AxlEmitter();
        await expect(emitter.emit('nothing')).resolves.toBeUndefined();
    });

    it('respects priority set via third argument', async () => {
        const emitter = new AxlEmitter();
        const order: string[] = [];
        emitter.on('e', () => { order.push('low'); }, 0);
        emitter.on('e', () => { order.push('high'); }, 100);
        await emitter.emit('e');
        expect(order).toEqual(['high', 'low']);
    });

    it('respects priority embedded in descriptor object', async () => {
        const emitter = new AxlEmitter();
        const order: string[] = [];
        emitter.on('e', { callback: () => { order.push('A'); }, priority: 5 });
        emitter.on('e', { callback: () => { order.push('B'); }, priority: 50 });
        await emitter.emit('e');
        expect(order).toEqual(['B', 'A']);
    });

    it('once() listener fires only on first emit', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        emitter.once('ping', () => { calls.push(1); });
        await emitter.emit('ping');
        await emitter.emit('ping');
        expect(calls).toEqual([1]);
    });

    it('once via descriptor object works the same', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        emitter.on('ping', { callback: () => { calls.push(1); }, priority: 0, once: true });
        await emitter.emit('ping');
        await emitter.emit('ping');
        expect(calls).toEqual([1]);
    });

    it('off() removes a specific listener', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        const handler = () => { calls.push(1); };
        emitter.on('e', handler);
        emitter.off('e', handler);
        await emitter.emit('e');
        expect(calls).toEqual([]);
    });

    it('off() with descriptor matches by callback reference', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        const cb = () => { calls.push(1); };
        const descriptor: PriorityListener = { callback: cb, priority: 0 };
        emitter.on('e', descriptor);
        emitter.off('e', descriptor);
        await emitter.emit('e');
        expect(calls).toEqual([]);
    });

    it('off() on non-existent event does nothing', () => {
        const emitter = new AxlEmitter();
        expect(() => emitter.off('nope', () => {})).not.toThrow();
    });

    it('offAll() removes all listeners for an event', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        emitter.on('e', () => { calls.push(1); });
        emitter.on('e', () => { calls.push(2); });
        emitter.offAll('e');
        await emitter.emit('e');
        expect(calls).toEqual([]);
    });

    it('offAll() called from within a callback aborts remaining listeners', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        emitter.on('e', () => {
            calls.push(1);
            emitter.offAll('e');
        }, 10);
        emitter.on('e', () => { calls.push(2); }, 0);
        await emitter.emit('e');
        expect(calls).toEqual([1]);
    });

    it('events are independent of each other', async () => {
        const emitter = new AxlEmitter();
        const a: number[] = [];
        const b: number[] = [];
        emitter.on('a', () => { a.push(1); });
        emitter.on('b', () => { b.push(2); });
        await emitter.emit('a');
        expect(a).toEqual([1]);
        expect(b).toEqual([]);
    });

    it('listener added during emit runs in the current emission', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];

        emitter.on('e', () => {
            calls.push(1);
            // Add a low-priority listener mid-flight
            emitter.on('e', () => { calls.push(99); }, -10);
        }, 10);

        await emitter.emit('e');
        // The newly-added listener has lower priority so it runs after the adder
        expect(calls).toContain(99);
        expect(calls.indexOf(1)).toBeLessThan(calls.indexOf(99));
    });

    it('multiple off() calls are idempotent', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        const h = () => { calls.push(1); };
        emitter.on('e', h);
        emitter.off('e', h);
        emitter.off('e', h); // second call must not throw
        await emitter.emit('e');
        expect(calls).toEqual([]);
    });

    it('same handler registered twice fires twice', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        const h = () => { calls.push(1); };
        emitter.on('e', h);
        emitter.on('e', h);
        await emitter.emit('e');
        expect(calls).toEqual([1, 1]);
    });

    it('off() removes all duplicates of the same handler', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        const h = () => { calls.push(1); };
        emitter.on('e', h);
        emitter.on('e', h);
        emitter.off('e', h);
        await emitter.emit('e');
        expect(calls).toEqual([]);
    });

    it('async listener errors propagate through emit()', async () => {
        const emitter = new AxlEmitter();
        emitter.on('e', async () => { throw new Error('async-fail'); });
        await expect(emitter.emit('e')).rejects.toThrow('async-fail');
    });

    it('listeners on other events are not affected by offAll on one event', async () => {
        const emitter = new AxlEmitter();
        const calls: number[] = [];
        emitter.on('a', () => { calls.push(1); });
        emitter.on('b', () => { calls.push(2); });
        emitter.offAll('a');
        await emitter.emit('a');
        await emitter.emit('b');
        expect(calls).toEqual([2]);
    });
});

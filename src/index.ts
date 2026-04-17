/**
 * A single listener entry with an explicit priority and optional one-shot flag.
 *
 * @template T Tuple of argument types the callback accepts.
 */
export type PriorityListener<T extends any[] = any[]> = {
    /** The handler to invoke. May return a Promise — it will be awaited. */
    callback: (...args: T) => Promise<void> | void;
    /**
     * Execution order relative to other listeners on the same event.
     * Higher number = runs first. Ties are resolved by insertion order.
     */
    priority: number;
    /** When `true` the listener is removed automatically after the first invocation. */
    once?: boolean;
};

/**
 * Anything accepted by `on()` / `once()`: either a raw callback function
 * or a full {@link PriorityListener} descriptor object.
 *
 * @template T Tuple of argument types.
 */
export type AxlListener<T extends any[] = any[]> =
    | PriorityListener<T>
    | ((...args: T) => unknown);

/**
 * Runs an array of priority listeners sequentially, awaiting each one.
 *
 * Key behaviours:
 * - Listeners are sorted **descending** by `priority` before the first call.
 * - `once` listeners are spliced out **before** their callback runs
 *   (so re-entrancy or errors don't leave stale entries).
 * - If the array is emptied mid-flight (e.g. by a callback calling `offAll`)
 *   the loop exits early via the `listeners.length === 0` guard.
 * - The array is mutated in place, so callers share the same reference.
 *
 * @param listeners Mutable array of listeners to process (sorted in place).
 * @param args      Arguments forwarded to every callback.
 *
 * @example
 * ```ts
 * const queue: PriorityListener[] = [
 *   { callback: async () => console.log('B'), priority: 0 },
 *   { callback: async () => console.log('A'), priority: 10 },
 * ];
 * await processListeners(queue); // prints: A then B
 * ```
 */
export const processListeners = async <T extends any[]>(
    listeners: PriorityListener<T>[],
    ...args: T
): Promise<void> => {
    listeners.sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < listeners.length; i++) {
        const listener = listeners[i];
        if (listener.once) {
            listeners.splice(i, 1);
            i--;
        }
        await listener.callback(...args);
        if (listeners.length === 0) return;
    }
};

/**
 * Async event emitter with priority queues and a mutable listener list.
 *
 * - Listeners run **sequentially** and are **awaited**, so every handler
 *   completes before the next one starts.
 * - Each listener carries a numeric `priority` (default `0`); higher wins.
 * - Any callback can mutate the queue mid-flight: add listeners, remove them,
 *   or call `offAll()` to abort the rest of the current emission.
 *
 * @example
 * ```ts
 * const emitter = new AxlEmitter();
 *
 * emitter.on('data', async (payload) => {
 *   await saveToDb(payload);
 * }, 10); // high priority
 *
 * emitter.on('data', (payload) => {
 *   log(payload);
 * }); // priority 0, runs after
 *
 * await emitter.emit('data', { value: 42 });
 * ```
 */
export class AxlEmitter {
    private listeners: Record<string, PriorityListener[]> = {};

    /**
     * Registers a persistent listener for `event`.
     *
     * @param event    Event name.
     * @param listener Callback function or {@link PriorityListener} descriptor.
     *                 When a descriptor is supplied its own `priority` field takes
     *                 precedence over the third argument.
     * @param priority Default priority when `listener` is a plain function. Default `0`.
     */
    on(event: string, listener: AxlListener, priority = 0): void {
        const bucket = (this.listeners[event] ??= []);
        if (typeof listener === 'function') {
            bucket.push({ callback: listener as (...args: any[]) => Promise<void>, priority });
        } else {
            bucket.push({ ...listener, priority: listener.priority ?? 0 });
        }
    }

    /**
     * Registers a **one-shot** listener that is automatically removed after it
     * fires once.
     *
     * @param event    Event name.
     * @param listener Callback function or {@link PriorityListener} descriptor.
     * @param priority Default priority when `listener` is a plain function. Default `0`.
     */
    once(event: string, listener: AxlListener, priority = 0): void {
        const bucket = (this.listeners[event] ??= []);
        if (typeof listener === 'function') {
            bucket.push({ callback: listener as (...args: any[]) => Promise<void>, priority, once: true });
        } else {
            bucket.push({ ...listener, priority: listener.priority ?? 0, once: true });
        }
    }

    /**
     * Removes all registrations of `listener` from `event`.
     * Works for both plain functions and descriptor objects (matched by `callback`
     * reference).
     *
     * @param event    Event name.
     * @param listener The same reference that was passed to `on` / `once`.
     */
    off(event: string, listener: AxlListener): void {
        if (!this.listeners[event]) return;
        const cb = typeof listener === 'function' ? listener : listener.callback;
        const bucket = this.listeners[event];
        for (let i = bucket.length - 1; i >= 0; i--) {
            if (bucket[i].callback === cb) bucket.splice(i, 1);
        }
    }

    /**
     * Removes **all** listeners for `event` immediately.
     *
     * When called from within an active emission the current loop detects the
     * empty array and exits without invoking any further callbacks.
     *
     * @param event Event name.
     */
    offAll(event: string): void {
        if (this.listeners[event]) this.listeners[event].length = 0;
    }

    /**
     * Emits `event`, passing `args` to every registered listener in
     * priority-descending order.  Returns a Promise that resolves when all
     * listeners have settled.
     *
     * @param event Event name.
     * @param args  Arguments forwarded to every listener.
     * @returns     Promise that resolves when the queue is drained.
     *
     * @example
     * ```ts
     * await emitter.emit('save', record);
     * console.log('all handlers finished');
     * ```
     */
    emit(event: string, ...args: any[]): Promise<void> {
        return processListeners(this.listeners[event] ?? [], ...args);
    }
}

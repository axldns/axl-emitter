# axl-emitter

Async event emitter with **priority queues** and a **mutable mid-flight listener list**.

- Listeners run **sequentially** and are **awaited** — each handler finishes before the next starts.
- Numeric **priority** controls order (higher = first). Default is `0`.
- `once` listeners auto-remove after the first invocation.
- Any callback can mutate the queue while it's running: add listeners, remove them, or call `offAll()` to abort remaining callbacks.
- Ships as both a **class** (`AxlEmitter`) and a standalone **utility function** (`processListeners`).
- Dual package: **CJS** + **ESM**, full TypeScript types.
- **Zero dependencies**, lightweight.

---

## Install

```sh
npm install axl-emitter
```

---

## Usage

### Extend the class

```ts
import { AxlEmitter } from 'axl-emitter';

class Dog extends AxlEmitter {
  bark() {
    return this.emit('bark', '🐕 woof!');
  }
}

const dog = new Dog();

dog.on('bark', (sound) => console.log('neighbor heard:', sound), 10);
dog.on('bark', () => console.log('whole street heard it'), 0);

await dog.bark();
```

### Abort mid-flight

```ts
// priority 20 runs first — if owner is notified, no need to wake the neighbors
dog.on('bark', async (sound) => {
  await notifyOwner(sound);
  dog.offAll('bark'); // cancels remaining listeners for this emission
}, 20);

await dog.bark();
// notifyOwner runs, then the queue is cleared — neighbors stay asleep
```

### `once` — fire and forget

```ts
dog.once('bark', () => console.log('first bark ever 🎉'));

await dog.bark(); // prints the message
await dog.bark(); // nothing
```

### Remove listeners

```ts
const handler = (sound: string) => console.log(sound);
dog.on('bark', handler);

dog.off('bark', handler);  // remove one
dog.offAll('bark');        // remove all
```

### Listener descriptor object

```ts
dog.on('bark', {
  callback: async (sound) => save(sound),
  priority: 50,
  once: true,
});
```

### Standalone utility

Manage your own arrays without the class:

```ts
import { processListeners, PriorityListener } from 'axl-emitter';

const queue: PriorityListener<[string]>[] = [
  { callback: (msg) => console.log('B', msg), priority:  0 },
  { callback: (msg) => console.log('A', msg), priority: 10 },
];

await processListeners(queue, 'hello');
// A hello
// B hello
```

---

## API

### `AxlEmitter`

| Method | Description |
|---|---|
| `on(event, listener, priority?)` | Register a persistent listener. |
| `once(event, listener, priority?)` | Register a one-shot listener. |
| `off(event, listener)` | Remove a specific listener (matched by callback reference). |
| `offAll(event)` | Remove all listeners for an event. Also aborts the current emission. |
| `emit(event, ...args)` | Fire all listeners; returns `Promise<void>`. |

`listener` can be a plain function or a `PriorityListener` descriptor:

```ts
type PriorityListener<T extends any[]> = {
  callback: (...args: T) => Promise<void> | void;
  priority: number;
  once?: boolean;
};
```

### `processListeners(listeners, ...args)`

Standalone async runner. Sorts `listeners` in place and processes them sequentially.

---

## Priority rules

- Higher `priority` number = runs **first**.
- Ties are broken by insertion order.
- Default priority is `0`.

---

## License

MIT

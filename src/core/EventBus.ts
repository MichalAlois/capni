type EventListener<TEventMap extends object> = (payload: TEventMap[keyof TEventMap]) => void;

export class EventBus<TEventMap extends object> {
  private readonly listeners = new Map<keyof TEventMap, Set<EventListener<TEventMap>>>();

  public on<K extends keyof TEventMap>(event: K, listener: (payload: TEventMap[K]) => void): void {
    const eventListeners = this.listeners.get(event) ?? new Set<EventListener<TEventMap>>();
    eventListeners.add(listener as unknown as EventListener<TEventMap>);
    this.listeners.set(event, eventListeners);
  }

  public once<K extends keyof TEventMap>(event: K, listener: (payload: TEventMap[K]) => void): void {
    const onceListener = (payload: TEventMap[K]): void => {
      this.off(event, onceListener);
      listener(payload);
    };

    this.on(event, onceListener);
  }

  public off<K extends keyof TEventMap>(event: K, listener: (payload: TEventMap[K]) => void): void {
    this.listeners.get(event)?.delete(listener as unknown as EventListener<TEventMap>);
  }

  public emit<K extends keyof TEventMap>(event: K, payload: TEventMap[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(payload);
    }
  }

  public removeAllListeners(): void {
    this.listeners.clear();
  }
}

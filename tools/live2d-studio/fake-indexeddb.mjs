function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeRequest {
  result = undefined;
  error = null;
  onsuccess = null;
  onerror = null;
}

class FakeTransaction {
  constructor(storeData) {
    this.storeData = storeData;
    this.pending = 0;
    this.completed = false;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.error = null;
  }

  objectStore() {
    return new FakeObjectStore(this, this.storeData);
  }

  request(operation) {
    const request = new FakeRequest();
    this.pending += 1;
    queueMicrotask(() => {
      try {
        request.result = clone(operation());
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        const event = {
          target: request,
          preventDefault() {},
          stopPropagation() {}
        };
        request.onerror?.(event);
        if (!request.onerror) {
          this.error = error;
          this.onerror?.({ target: this });
        }
      } finally {
        this.pending -= 1;
        this.maybeComplete();
      }
    });
    return request;
  }

  maybeComplete() {
    if (this.pending || this.completed || this.error) return;
    queueMicrotask(() => {
      if (this.pending || this.completed || this.error) return;
      this.completed = true;
      this.oncomplete?.({ target: this });
    });
  }
}

class FakeObjectStore {
  constructor(transaction, data) {
    this.transaction = transaction;
    this.data = data;
  }

  get(key) {
    return this.transaction.request(() => this.data.get(key));
  }

  add(value) {
    return this.transaction.request(() => {
      const key = value?.id;
      if (this.data.has(key)) {
        const error = new Error(`Key already exists: ${key}`);
        error.name = 'ConstraintError';
        throw error;
      }
      this.data.set(key, clone(value));
      return key;
    });
  }

  put(value) {
    return this.transaction.request(() => {
      const key = value?.id;
      this.data.set(key, clone(value));
      return key;
    });
  }

  delete(key) {
    return this.transaction.request(() => this.data.delete(key));
  }

  getAll() {
    return this.transaction.request(() => [...this.data.values()]);
  }
}

class FakeDatabase {
  constructor(record) {
    this.record = record;
    this.objectStoreNames = {
      contains: (name) => this.record.stores.has(name)
    };
  }

  createObjectStore(name) {
    const data = new Map();
    this.record.stores.set(name, data);
    return new FakeObjectStore(new FakeTransaction(data), data);
  }

  transaction(name) {
    const data = this.record.stores.get(name);
    if (!data) throw new Error(`Missing object store: ${name}`);
    return new FakeTransaction(data);
  }

  close() {}
}

export function createFakeIndexedDB() {
  const databases = new Map();
  return {
    dump(name, storeName) {
      return [...(databases.get(name)?.stores.get(storeName)?.values() || [])].map(clone);
    },
    open(name, version = 1) {
      const request = new FakeRequest();
      queueMicrotask(() => {
        const existing = databases.get(name);
        const record = existing || { version: 0, stores: new Map() };
        const upgrade = version > record.version;
        record.version = Math.max(record.version, version);
        databases.set(name, record);
        request.result = new FakeDatabase(record);
        if (upgrade) request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      });
      return request;
    }
  };
}

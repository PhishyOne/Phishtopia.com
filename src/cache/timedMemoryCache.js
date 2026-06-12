export function createTimedMemoryCache(defaultTtlMs) {
    const store = new Map();

    function get(key) {
        const entry = store.get(key);
        if (!entry) return null;

        if (entry.expiresAt <= Date.now()) {
            store.delete(key);
            return null;
        }

        return entry.value;
    }

    function set(key, value, ttlMs = defaultTtlMs) {
        store.set(key, {
            value,
            expiresAt: Date.now() + ttlMs
        });
    }

    function remove(key) {
        store.delete(key);
    }

    function clear() {
        store.clear();
    }

    return {
        get,
        set,
        delete: remove,
        clear
    };
}

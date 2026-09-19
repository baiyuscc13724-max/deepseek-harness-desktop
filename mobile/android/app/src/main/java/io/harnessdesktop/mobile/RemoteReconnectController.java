package io.harnessdesktop.mobile;

import java.util.EnumMap;

/** Owns transport retries, never application requests. The Scheduler must serialize
 * its callbacks with owner lifecycle/UI mutations (Android's main Handler).
 * State locks are short; connect and UI actions always run outside them. An action
 * already admitted on the owner thread is not interrupted by a later stop.
 */
final class RemoteReconnectController {
    enum Channel { REMOTE, NATIVE }
    interface Scheduler {
        void postDelayed(Runnable action, long delayMillis);
        void removeCallbacks(Runnable action);
    }
    interface Connector { void connect(Token token); }

    static final class Token {
        private final State state;
        private boolean failed;
        private Token(State state) { this.state = state; }
    }
    private static final class State {
        final Object profile;
        final Channel channel;
        final Connector connector;
        int failures;
        Token token;
        Runnable pending;
        State(Object profile, Channel channel, Connector connector) {
            this.profile = profile;
            this.channel = channel;
            this.connector = connector;
        }
    }

    private final Scheduler scheduler;
    private final EnumMap<Channel, State> states = new EnumMap<>(Channel.class);
    private Object profile;

    RemoteReconnectController(Scheduler scheduler) { this.scheduler = scheduler; }

    /** Explicit activation replaces this channel even for an identical profile.
     * A different profile invalidates both channels before its first connection.
     */
    void start(Object profile, Channel channel, Connector connector) {
        if (profile == null || channel == null || connector == null) throw new IllegalArgumentException("Missing reconnect identity");
        final Token token;
        synchronized (this) {
            if (this.profile != profile) stop();
            this.profile = profile;
            cancelPending(states.remove(channel));
            State state = new State(profile, channel, connector);
            states.put(channel, state);
            token = state.token = new Token(state);
        }
        post(token, () -> connector.connect(token));
    }

    /** All transport notifications, including ready route/UI work, are checked
     * again when the serialized owner queue executes, not before it queues them.
     */
    void post(Token token, Runnable action) {
        scheduler.postDelayed(() -> {
            synchronized (this) { if (!current(token) || token.failed) return; }
            action.run();
        }, 0L);
    }

    void ready(Token token, Runnable action) {
        scheduler.postDelayed(() -> {
            synchronized (this) {
                if (!current(token) || token.failed) return;
                token.state.failures = 0;
                cancelPending(token.state);
            }
            action.run();
        }, 0L);
    }

    void failed(Token token, Runnable action) {
        scheduler.postDelayed(() -> {
            final Runnable retry;
            final long delay;
            synchronized (this) {
                if (!current(token) || token.failed) return;
                token.failed = true;
                State state = token.state;
                delay = retryDelay(state.channel, state.failures);
                state.failures = Math.min(state.failures + 1, 6);
                retry = () -> retry(token);
                state.pending = retry;
            }
            // A reentrant stop/start from the action prevents even timer posting.
            action.run();
            synchronized (this) {
                if (current(token) && token.state.pending == retry) scheduler.postDelayed(retry, delay);
            }
        }, 0L);
    }

    private void retry(Token previous) {
        final Token next;
        final Connector connector;
        synchronized (this) {
            if (!current(previous) || !previous.failed || previous.state.pending == null) return;
            State state = previous.state;
            state.pending = null;
            next = state.token = new Token(state);
            connector = state.connector;
        }
        // On the same serialized owner queue: no user code holds the monitor.
        connector.connect(next);
    }

    synchronized void stop() {
        for (State state : states.values()) cancelPending(state);
        states.clear();
        profile = null;
    }

    private boolean current(Token token) {
        return token != null && profile == token.state.profile
            && states.get(token.state.channel) == token.state && token.state.token == token;
    }

    private void cancelPending(State state) {
        if (state != null && state.pending != null) {
            scheduler.removeCallbacks(state.pending);
            state.pending = null;
        }
    }

    private static long retryDelay(Channel channel, int attempt) {
        return channel == Channel.NATIVE
            ? Math.min(30_000L, 5_000L + attempt * 5_000L)
            : Math.min(15_000L, 3_000L + attempt * 2_000L);
    }
}

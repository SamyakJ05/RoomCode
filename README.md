# roomcode.lol

Six-digit room. One line each. Host dumps. Then it vanishes.

## Run

```bash
node server.js
```

Open http://localhost:3847

## How it works

1. Host opens a room and reads the 6-digit code out loud.
2. Everyone walks in with the code and writes one line.
3. Host hits **dump the room**. Lines shuffle. Names stay off the wall.
4. Host hits **burn the room**. Memory is wiped. Rooms also die after 2 hours.

Nothing is written to disk. State lives in process memory only.

## Rules worth keeping

- 18+
- 40 people max
- 280 characters
- Host-only dump and close
- Not a court transcript

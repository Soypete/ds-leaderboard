# Player guide — CLI, submitting runs, and guilds

Everything a player does: claim a banner, seal a receipt, submit a run, and join or
muster a guild.

## 1. The `gme` CLI

The game ships a `gme leaderboard` command that prepares your leaderboard entries.
It only **seals** receipts — it never submits them (that's the PR step in §2).

```bash
gme leaderboard whoami                 # show your claimed handle
gme leaderboard whoami --set <handle>  # claim your GitHub handle (once)
gme leaderboard receipt --stdout       # seal a receipt, print to screen
gme leaderboard receipt --out run.json # seal a receipt to a file
gme leaderboard receipt --day 2026-06-22   # seal for a specific day
gme leaderboard trials --json          # dump the trial catalog
```

- **Claim your handle first** — it must match your GitHub login, lowercased. It's
  saved to `~/.gme/config.json` and stamped onto every receipt.
- A **receipt** is a signed snapshot of your day's gold haul + your standing trial
  speedruns, taken from your save. Its `contentHash` proves the file wasn't altered.
- Your receipt only carries what you've actually earned — play first (slay bugs,
  clear trials) so it has something in it.

> Running from source instead of an installed `gme`? Use
> `npm run dev -- leaderboard <args>` in the DragonSlayer repo.

## 2. Submitting a run (open a PR)

Today, submitting = opening a pull request to the **submissions repo**
([ds-submissions](https://github.com/Soypete/ds-submissions)).

1. Seal your receipt to a file under `receipts/`:
   ```bash
   gme leaderboard receipt --out receipts/<your-handle>-<YYYY-MM-DD>.json
   ```
2. **Attach your proof media** in the PR — a **screenshot** for a daily-gold haul, a
   **video** for a trial speedrun. Drag-and-drop into the PR description (works for
   images and video), or paste a link. (`gh pr create --body` with a link works too;
   plain `git` can't attach media.)
3. Open the PR. The ingest Action checks your handle matches the PR author and that
   the receipt hash is intact, then files your run as **pending**.
4. A maintainer **approves the PR** and then approves the run in the moderator queue.
   Only then does it appear on the public board.

**The rules:** your receipt's `githubHandle` must equal the PR author (you can only
submit your own runs); the media is the real proof of the run — the hash only proves
the file wasn't edited.

## 3. Guilds — private & team boards

A **guild** is your own scoped leaderboard, separate from the global one — for a
team, class, or friend group. Two kinds:

- **Open** — public, anyone can browse and join.
- **Private** — invite-only; invisible unless you're a member.

### Join a guild
- **Open guild:** browse `/guilds`, open one, and join.
- **Private guild:** you need an **invite link** (`/invite/<token>`) from a member.
  Sign in with GitHub, open the link, and you're added as a member.

### Muster (create) your own
1. Sign in with GitHub.
2. `/guilds/new` → name it (becomes a URL slug, e.g. `/guilds/roundtable`), choose
   open or private.
3. You're the **owner**. Mint invite links to bring people in.

### Roles & ownership
- **owner** — full control: promote/demote mods, remove members, transfer
  ownership, disband.
- **mod** — can remove plain members (not other mods or the owner).
- **member** — rides the board; can leave anytime.

You may own up to **5 guilds**. If the owner leaves, ownership auto-passes to the
senior mod (or oldest member); if they're the last one out, the guild disbands.

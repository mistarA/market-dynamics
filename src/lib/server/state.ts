import type { Snapshot } from '../types';
import type { ScripcodeMap } from '../symbols';
import type { Runtime } from './runtime';

export async function readCoreSnapshot(rt: Runtime): Promise<Snapshot | null> {
  return rt.store.read<Snapshot>(rt.path.snapshot);
}

export async function readScripcodes(rt: Runtime): Promise<ScripcodeMap> {
  return (await rt.store.read<ScripcodeMap>(rt.path.scripcodes)) ?? {};
}

export async function writeScripcodes(
  rt: Runtime,
  map: ScripcodeMap,
): Promise<void> {
  if (!rt.persist) return;
  const sorted = Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => a.localeCompare(b)),
  );
  await rt.store.write(rt.path.scripcodes, sorted);
}

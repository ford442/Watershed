import { RapierWorkerProxy } from './RapierWorkerProxy';

export function createRapierWorkerProxy(): RapierWorkerProxy {
  const worker = new Worker(new URL('./rapier.worker.ts', import.meta.url), { type: 'module' });
  return new RapierWorkerProxy(worker);
}

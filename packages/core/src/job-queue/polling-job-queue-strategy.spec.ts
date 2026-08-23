import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';

describe('PollingJobQueueStrategy', () => {
    let strategy: InMemoryJobQueueStrategy;

    beforeEach(() => {
        strategy = new InMemoryJobQueueStrategy({ concurrency: 1, pollInterval: 10 });
        strategy.init({
            get() {
                return { isWorker: false };
            },
        } as any);
    });

    afterEach(() => {
        strategy.destroy();
    });

    it('releases the concurrency slot even when the settling update() throws', async () => {
        const originalUpdate = strategy.update.bind(strategy);
        let updateCallCount = 0;
        vi.spyOn(strategy, 'update').mockImplementation(async (job: Job) => {
            updateCallCount++;
            if (updateCallCount === 2) {
                // Simulate the settling update for the first job failing,
                // e.g. a transient DB error.
                throw new Error('simulated update failure');
            }
            return originalUpdate(job);
        });

        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        await strategy.add(new Job({ id: 'job-2', queueName: 'test', data: {} }));

        const processed: string[] = [];
        const process = async (job: Job) => {
            processed.push(job.id as string);
            return true;
        };
        await strategy.start('test', process);

        await vi.waitFor(
            () => {
                expect(processed).toEqual(['job-1', 'job-2']);
            },
            { timeout: 2000, interval: 20 },
        );

        await strategy.stop('test', process);
    });
});

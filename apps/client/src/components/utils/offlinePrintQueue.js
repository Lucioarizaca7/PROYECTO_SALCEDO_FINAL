export function offlinePrintQueue() {
  // Create queue file if it doesn't exist
  const queueFile = 'C:\\visual_code\\Proyecto_Final_Salcedo_Rentas\\apps\\client\\src\\components\\utils\\offlinePrintQueue.dat';

  const fs = require('fs').promises;

  // Initialize queue if file doesn't exist
  if (!await fs.access(queueFile).then(() => true).catch(() => false)) {
    await fs.writeFile(queueFile, '[]');
  }

  // Read current queue
  let queue = JSON.parse(await fs.readFile(queueFile, 'utf8'));

  // Add new print job with timestamp
  const newJob = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    status: 'pending',
    files: [],
    priority: 'medium',
    completed: false
  };

  queue.push(newJob);

  // Write updated queue back to file
  await fs.writeFile(queueFile, JSON.stringify(queue, null, 2));

  console.log(`Print job queued: ${newJob.id} - ${newJob.timestamp}`);
  return newJob;
}
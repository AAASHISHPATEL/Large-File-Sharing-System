import amqp from 'amqplib';

let connection: amqp.Connection | null = null;
let channel: amqp.Channel | null = null;

const QUEUE_NAME = 'file_stitch_queue';
const DLQ_NAME = 'file_stitch_dlq';
const EXCHANGE_NAME = 'file_exchange';

export const connectRabbitMQ = async () => {
    const rabbitMqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    try {
        connection = (await amqp.connect(rabbitMqUrl)) as any;
        if (!connection) throw new Error("Could not connect");
        channel = (await (connection as any).createChannel()) as any;
        if (!channel) return;

        // Setup DLQ
        await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
        await channel.assertQueue(DLQ_NAME, { durable: true });
        
        // Setup Main Queue with DLQ arguments
        await channel.assertQueue(QUEUE_NAME, { 
            durable: true,
            arguments: {
                'x-dead-letter-exchange': EXCHANGE_NAME,
                'x-dead-letter-routing-key': 'dlq'
            }
        });

        await channel.bindQueue(DLQ_NAME, EXCHANGE_NAME, 'dlq');

        console.log('✅ RabbitMQ connected and queues asserted.');
    } catch (error) {
        console.error('❌ Failed to connect to RabbitMQ:', error);
    }
};

export const getRabbitChannel = () => channel;

export interface StitchJobData {
    uploadId: string;
    totalChunks: number;
    userId: string;
}

export const publishStitchJob = async (job: StitchJobData) => {
    if (!channel) {
        throw new Error('RabbitMQ channel not initialized');
    }
    const messageBuffer = Buffer.from(JSON.stringify(job));
    channel.sendToQueue(QUEUE_NAME, messageBuffer, { persistent: true });
};

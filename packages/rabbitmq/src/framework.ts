import {
  BaseFramework,
  getClassMetadata,
  getProviderId,
  IMidwayBootstrapOptions,
  listModule,
  listPropertyDataFromClass,
  MidwayFrameworkType,
  MidwayRequestContainer,
} from '@midwayjs/core';

import {
  MS_CONSUMER_KEY,
  MSListenerType,
  RabbitMQListenerOptions,
} from '@midwayjs/decorator';
import {
  IMidwayRabbitMQApplication,
  IMidwayRabbitMQConfigurationOptions,
  IMidwayRabbitMQContext,
} from './interface';
import { RabbitMQServer } from './mq';
import { ConsumeMessage } from 'amqplib';
import { MidwayRabbitMQContextLogger } from './logger';

export class MidwayRabbitMQFramework extends BaseFramework<
  IMidwayRabbitMQApplication,
  IMidwayRabbitMQConfigurationOptions
> {
  public app: IMidwayRabbitMQApplication;
  public consumerList = [];

  public configure(
    options: IMidwayRabbitMQConfigurationOptions
  ): MidwayRabbitMQFramework {
    this.configurationOptions = options;
    return this;
  }

  async applicationInitialize(options) {
    this.app = (new RabbitMQServer(
      this.configurationOptions
    ) as unknown) as IMidwayRabbitMQApplication;
    // init connection
    await this.app.init();
  }

  protected async afterContainerReady(
    options: Partial<IMidwayBootstrapOptions>
  ): Promise<void> {
    await this.loadSubscriber();
  }

  public async run(): Promise<void> {
    await Promise.all(this.consumerList);
  }

  protected async beforeStop(): Promise<void> {
    await this.app.close();
  }

  public getFrameworkType(): MidwayFrameworkType {
    return MidwayFrameworkType.WS_IO;
  }

  public getApplication(): IMidwayRabbitMQApplication {
    return this.app;
  }

  private async loadSubscriber() {
    // create room
    const subscriberModules = listModule(MS_CONSUMER_KEY);
    for (const module of subscriberModules) {
      const type: MSListenerType = getClassMetadata(MS_CONSUMER_KEY, module);

      if (type !== MSListenerType.RABBITMQ) {
        continue;
      }

      // get providerId
      const providerId = getProviderId(module);
      // get listenerInfo
      const data: RabbitMQListenerOptions[][] = listPropertyDataFromClass(
        MS_CONSUMER_KEY,
        module
      );

      for (const methodBindListeners of data) {
        for (const listenerOptions of methodBindListeners) {
          this.consumerList.push(
            this.bindConsumerToRequestMethod(listenerOptions, providerId)
          );
        }
      }
    }
  }

  bindConsumerToRequestMethod(listenerOptions, providerId) {
    return this.app.createConsumer(
      listenerOptions,
      async (data?: ConsumeMessage) => {
        const ctx = {
          channel: this.app.getChannel(),
          startTime: Date.now(),
          queueName: listenerOptions.queueName,
        } as IMidwayRabbitMQContext;
        ctx.logger = new MidwayRabbitMQContextLogger(ctx, this.appLogger);
        const requestContainer = new MidwayRequestContainer(
          ctx,
          this.getApplicationContext()
        );
        ctx.requestContext = requestContainer;
        ctx.getRequestContext = () => {
          return requestContainer;
        };
        const ins = await requestContainer.getAsync(providerId);
        await ins[listenerOptions.propertyKey].call(ins, data);
      }
    );
  }
}

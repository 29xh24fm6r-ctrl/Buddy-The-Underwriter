export type SendEmailArgs = {
  to: string;
  from: string;
  subject: string;
  text: string;
};

export type SendEmailResult = {
  provider: string;
  provider_message_id: string | null;
};

export interface EmailProvider {
  send(args: SendEmailArgs): Promise<SendEmailResult>;
}

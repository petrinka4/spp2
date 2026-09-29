const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../logger');

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

const mailer = {
  async sendMail(message) {
    const info = await transport.sendMail({ from: config.smtp.from, ...message });
    logger.info({ event: 'mail.sent', to: message.to, messageId: info.messageId }, 'Mail sent');
    return info;
  },

  async sendPasswordReset(user, token) {
    const link = `${config.appUrl}/#reset?token=${token}`;
    return mailer.sendMail({
      to: user.email,
      subject: 'Восстановление доступа',
      text: [
        `Здравствуйте, ${user.name}!`,
        '',
        'Для смены пароля перейдите по ссылке:',
        link,
        '',
        `Ссылка действует ${config.resetTokenMinutes} минут.`,
        'Если вы не запрашивали восстановление, просто проигнорируйте письмо.',
      ].join('\n'),
    });
  },
};

module.exports = mailer;

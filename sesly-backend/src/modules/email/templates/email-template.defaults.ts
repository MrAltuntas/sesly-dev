import { EmailTemplateFields, EmailTemplateKind, EmailTemplateLanguage } from './email-template.types';

/**
 * Code default text of every template in every language. A row in
 * `email_templates` replaces it; resetting in the panel deletes the row.
 * Adding a UI language makes this object fail to compile until the new
 * language has its texts.
 *
 * Text rules (CLAUDE.md): no emoji, em dash, unicode ellipsis, arrows or
 * bullet glyphs. The spec checks every field.
 */
export const DEFAULT_EMAIL_TEMPLATES: Readonly<
  Record<EmailTemplateKind, Readonly<Record<EmailTemplateLanguage, EmailTemplateFields>>>
> = {
  welcome: {
    tr: {
      subject: "Sesly'ye hoş geldin",
      preheader: 'Masallar artık sevdiğin sesle anlatılıyor.',
      heading: "Sesly'ye hoş geldin",
      body: [
        'Merhaba {{name}},',
        'Aramıza katıldığın için çok mutluyuz. Sesly ile her gece yeni bir masal, sıcacık bir sesle anlatılıyor.',
        'Hazır anlatıcı seslerimizden birini seçebilir ya da kendi sesini kaydedip masalları **kendi sesinle** dinletebilirsin.',
        'İyi geceler, tatlı rüyalar.',
      ].join('\n\n'),
      buttonLabel: "Sesly'yi keşfet",
      note: '',
      footer: 'Bu e-postayı yeni bir Sesly hesabı açtığın için aldın.',
    },
    en: {
      subject: 'Welcome to Sesly',
      preheader: 'Bedtime stories, told in the voice you love.',
      heading: 'Welcome to Sesly',
      body: [
        'Hi {{name}},',
        'We are so happy you joined us. With Sesly, every night brings a new story told in a warm voice.',
        'Pick one of our ready-made narrator voices, or record your own and let the stories be told **in your voice**.',
        'Good night and sweet dreams.',
      ].join('\n\n'),
      buttonLabel: 'Explore Sesly',
      note: '',
      footer: 'You are receiving this email because you created a new Sesly account.',
    },
  },
  password_reset: {
    tr: {
      subject: 'Sesly şifreni sıfırla',
      preheader: 'Yeni şifreni belirlemek için bağlantı bu e-postada.',
      heading: 'Şifreni sıfırla',
      body: [
        'Merhaba {{name}},',
        '**{{email}}** adresiyle kayıtlı Sesly hesabın için bir şifre sıfırlama isteği aldık. Yeni şifreni belirlemek için aşağıdaki butona dokun.',
      ].join('\n\n'),
      buttonLabel: 'Yeni şifre belirle',
      note: 'Bu bağlantı 1 saat geçerlidir ve yalnızca bir kez kullanılabilir. Buton çalışmazsa bu bağlantıyı tarayıcına yapıştır:\n{{link}}',
      footer: 'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin, şifren değişmez.',
    },
    en: {
      subject: 'Reset your Sesly password',
      preheader: 'The link to choose a new password is in this email.',
      heading: 'Reset your password',
      body: [
        'Hi {{name}},',
        'We received a request to reset the password of the Sesly account registered with **{{email}}**. Tap the button below to choose a new password.',
      ].join('\n\n'),
      buttonLabel: 'Choose a new password',
      note: 'This link is valid for 1 hour and can be used only once. If the button does not work, paste this link into your browser:\n{{link}}',
      footer: 'If you did not ask for this, you can ignore this email. Your password will not change.',
    },
  },
};

import { Link } from 'react-router-dom';
import { LEGAL_PATHS, SUPPORT_EMAIL } from '@/features/content/legal';

const linkClass = 'text-text underline underline-offset-4 hover:text-accent';

/**
 * /bot — для владельцев сайтов, которые увидели KetnerBot в журнале сервера
 * (User-Agent `KetnerBot/1.0 (+https://ketner.org/bot)`, apps/mock-api/src/discovery/site-crawl.ts).
 */
export function BotPage() {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          KetnerBot
        </h1>
        <p className="text-[17px] leading-8 text-muted">
          KetnerBot читает страницы сайта, когда человек просит Ketner AI разобрать свой бизнес и
          даёт ссылку на сайт. Так анализ видит услуги, цены и способы связи, не заставляя человека
          пересказывать то, что уже написано на сайте.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Как он работает</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-muted">
          <li>Только по запросу: один разбор — одно чтение. Сайты по расписанию он не обходит.</li>
          <li>
            Не больше 10 страниц за раз: главная и страницы об услугах, ценах, компании, контактах,
            вопросах и записи.
          </li>
          <li>
            Соблюдает <code>robots.txt</code>: страницы, закрытые правилом <code>Disallow</code> для{' '}
            <code>User-agent: *</code>, не открывает. Если закрыт весь сайт — не читает ничего.
          </li>
          <li>Не входит в личные кабинеты, корзину и закрытые разделы, не заполняет формы.</li>
          <li>
            Заголовок запроса: <code>KetnerBot/1.0 (+https://ketner.org/bot)</code>.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Что хранится</h2>
        <p className="text-[15px] leading-7 text-muted">
          Короткий текст прочитанных страниц и найденные на них сведения (способы связи, цены, часы
          работы) хранятся вместе с анализом человека, который просил разбор, и удаляются вместе с
          ним. Подробнее — в{' '}
          <Link to={LEGAL_PATHS.privacy} className={linkClass}>
            политике конфиденциальности
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Связаться</h2>
        <p className="text-[15px] leading-7 text-muted">
          Если KetnerBot мешает вашему сайту, напишите на{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>{' '}
          или через{' '}
          <Link to="/contacts" className={linkClass}>
            форму на странице контактов
          </Link>
          .
        </p>
      </section>
    </article>
  );
}

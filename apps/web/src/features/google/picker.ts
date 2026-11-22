/**
 * Google Picker — окно Google для выбора файла (кнопка «Выбрать прежнюю таблицу», этап F).
 *
 * Зачем: после отзыва доступа и переподключения разрешение `drive.file` не покрывает таблицу,
 * которую Ketner создал раньше. Выбор файла в Picker с номером проекта Ketner (`appId`) даёт Ketner
 * доступ ровно к этому файлу — больше ни к чему в Диске. Подходит ли файл, сервер проверяет сам.
 *
 * Загрузчик apis.google.com подключается только при нажатии кнопки (CSP разрешает его и фрейм
 * docs.google.com).
 */

const LOADER_URL = 'https://apis.google.com/js/api.js';

/** Ответ Picker: ключи `action` и `docs` — значения `Response.ACTION` и `Response.DOCUMENTS`. */
interface PickerData {
  action?: string;
  docs?: Array<{ id?: string }>;
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (data: PickerData) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId: string) => { setMode(mode: string): unknown };
  ViewId: { SPREADSHEETS: string };
  DocsViewMode: { LIST: string };
  Action: { PICKED: string; CANCEL: string };
}

declare global {
  interface Window {
    gapi?: { load(name: string, options: { callback: () => void; onerror: () => void }): void };
    google?: { picker?: PickerNamespace };
  }
}

let loading: Promise<PickerNamespace> | null = null;

function loadPicker(): Promise<PickerNamespace> {
  if (window.google?.picker) return Promise.resolve(window.google.picker);
  loading ??= new Promise<PickerNamespace>((resolve, reject) => {
    const fail = () => {
      loading = null;
      reject(new Error('picker_unavailable'));
    };
    const ready = () =>
      window.gapi!.load('picker', {
        callback: () => (window.google?.picker ? resolve(window.google.picker) : fail()),
        onerror: fail,
      });
    if (window.gapi) {
      ready();
      return;
    }
    const script = document.createElement('script');
    script.src = LOADER_URL;
    script.async = true;
    script.onload = () => (window.gapi ? ready() : fail());
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

/** Открывает Picker со списком таблиц. Возвращает id выбранной или null, если окно закрыли. */
export async function pickSpreadsheet(options: {
  accessToken: string;
  apiKey: string;
  appId: string;
  locale: string;
  title: string;
}): Promise<string | null> {
  const picker = await loadPicker();
  return new Promise<string | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
    view.setMode(picker.DocsViewMode.LIST);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(options.accessToken)
      .setDeveloperKey(options.apiKey)
      .setAppId(options.appId)
      .setLocale(options.locale)
      .setTitle(options.title)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

# Отчёт о проверках — «Выдох» 2.0.1

## Выполнено
- `npm run check` — проверка синтаксиса JS-модулей, Service Worker и JSON-манифеста.
- `npm test` — полный набор регрессионных тестов, включая тесты идентичности бренда и PWA-иконок.
- Растровые активы проверены на точные размеры: 180×180, 192×192, 512×512 и 512×512.
- `manifest.webmanifest` проверен на наличие всех активных PNG-иконок, `start_url` и `scope`.
- `favicon.svg`, `brand-mark.svg`, `brand-app-icon.svg` и `brand-lockup.svg` включены в список Service Worker.
- ZIP проверен на целостность после сборки.

## Ограничение
В рамках этого релиза не проводился полный визуальный прогон на физических iPhone/Android. Установленные ярлыки PWA могут кэшировать прежние иконки операционной системой; если пользователь уже установил приложение, может понадобиться удалить старый ярлык и добавить новый после обновления сайта.


## Dark theme checks
- Theme values are sanitized to `light`, `dark`, or `system`.
- Theme selection is local and backward-compatible with existing v4 states and backups missing the new preference.
- All app sections, forms, controls, modals and the bottom navigation have dark-theme overrides.


## Version 2.0.0 — dark theme verification
- `npm run check`: passed.
- `npm test`: 85/85 tests passed, including 6 dedicated theme regression tests and the profile theme-setting contract.
- Theme preference values are sanitized (`light`, `dark`, `system`) and stored in local state; legacy states without a theme preference remain light by default.
- The `<html data-theme>` attribute and browser `theme-color` metadata update whenever the theme changes. The PWA manifest startup/background surface matches the default light theme to avoid a mismatched install splash.
- Dark theme defines branded deep green-black surfaces, mint/cyan accents, contrast-aware text, forms, menus, cards, overlays and bottom navigation.
- Physical-device contrast and PWA appearance should still be checked on iOS/Android before public release.
- Browser smoke attempt was blocked by the environment with `ERR_BLOCKED_BY_ADMINISTRATOR` on localhost. No claim is made that visual appearance has been verified in a live browser in this run; manual review on iOS/Android is recommended.

- Contrast spot-check (WCAG relative luminance): primary text on main dark background 15.89:1; secondary text on dark card 6.92:1; mint accent on main background 13.76:1; cyan accent on card 10.11:1. These are token-pair checks, not a full element-by-element accessibility audit.


## Dark theme refinement 2.0.1
- Пересмотрены цветовые токены и иерархия поверхностей; закреплены отдельные стили для карточек, вложенных элементов, практик, аналитики, форм и модальных окон.
- Добавлены тесты для палитры бренда, различимости карточек, слоя модальных окон, специальных компонентов и контрастных пар.
- Контрастные пары токенов рассчитаны по относительной яркости WCAG; подробные значения приведены в README.

## Итог текущего релиза 2.0.1
- `npm run check`: успешно.
- `npm test`: 92/92 теста пройдены.
- CSS разобран через `tinycss2`: 0 синтаксических ошибок; проверка учитывает вложенные `@media` и декларации `@property`.
- Выбранные контрастные пары: основной текст/фон 16.83:1; вторичный текст/основная карточка 8.05:1; мятный акцент/фон 12.40:1; текст основной кнопки 13.85:1.
- Обновлены `theme-color` метаданные для первой отрисовки и runtime, версия Service Worker `vydokh-redesign-2.0.1`.
- Ограничение: интерактивный screenshot-прогон Chromium в контейнере не завершился из-за зависания headless-браузера при запуске. Поэтому этот релиз не заявляется как визуально проверенный в реальном браузере; рекомендуем финальную ручную проверку на iPhone/Android и в браузере настольного компьютера.

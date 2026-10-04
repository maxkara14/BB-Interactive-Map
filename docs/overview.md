# Обзор интерфейса / Interface overview

[Русский PNG](images/overview.ru.png) · [English PNG](images/overview.en.png)

Обзор собран из действующих компонентов `index.js`, `map-state.js`, `map-links.js`, `map-topology-view.js` и `style.css`. Сцена демонстрационная, пользовательские чаты не читаются. Провайдеры и сохранение заменены локальными заглушками; изображения не являются ответом модели. Карта, виджет и игровые панели сняты в браузере, затем размещены на общем постере. Иллюстрация подготовлена для выпуска 2.0.

The overview uses the extension's production components and styles with a synthetic scene. It reads no user chats, requests no model and writes no chat data. Map, widget and game panels are captured in a browser and arranged on a poster. The overview accompanies the 2.0 release.

## Пересборка / Rebuild

From the repository root, using an existing Playwright installation and Chrome:

```powershell
node docs/render-overview.cjs "C:/path/to/node_modules/playwright"
```

Output: overview PNGs and component screenshots under `docs/images`. No new runtime dependency is required. The script checks browser errors and image loading. Animation is frozen through the browser's reduced-motion preference for consistent still images.

## Подготовка выпуска / Release preparation

- [x] Compare the current test branch with `origin/main` 1.1.0.
- [x] Rewrite matching RU/EN READMEs and a bilingual changelog.
- [x] Capture and inspect the RU/EN interface overviews.
- [x] Verify local documentation links, review the diff and run the relevant checks.

Documentation and overview assets were reviewed on `map_test` and approved by the author.

The author approved publishing version 2.0.0 on `main` on October 4, 2026, together with the map integrations in the main branches of Enhance and VNE.

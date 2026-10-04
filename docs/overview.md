# Обзор интерфейса / Interface overview

[Русский PNG](images/overview.ru.png) · [English PNG](images/overview.en.png)

Обзор собран из действующих компонентов `index.js`, `map-state.js`, `map-links.js`, `map-topology-view.js` и `style.css`. Сцена демонстрационная, пользовательские чаты не читаются. Провайдеры и сохранение заменены локальными заглушками; изображения не являются ответом модели. Карта, виджет и игровые панели сняты в браузере, затем размещены на общем постере. Иллюстрация фиксирует предрелиз 2.0, а не номер в manifest.

The overview uses the extension's production components and styles with a synthetic scene. It reads no user chats, requests no model and writes no chat data. Map, widget and game panels are captured in a browser and arranged on a poster. “2.0 preview” describes the upcoming release, not the manifest version.

## Пересборка / Rebuild

From the repository root, using an existing Playwright installation and Chrome:

```powershell
node docs/render-overview.cjs "C:/path/to/node_modules/playwright"
```

Output: overview PNGs and component screenshots under `docs/images`. No new runtime dependency is required. The script checks browser errors and image loading. Animation is frozen through the browser's reduced-motion preference for consistent still images.

## План предрелиза / Preview preparation

- [x] Compare the current test branch with `origin/main` 1.1.0.
- [x] Rewrite matching RU/EN READMEs and a bilingual changelog.
- [x] Capture and inspect the RU/EN interface overviews.
- [x] Verify local documentation links, review the diff and run the relevant checks.

Publication target: `map_test`. The containing commit bundles documentation and overview assets.

After the author's final review: update the manifest to 2.0.0, finalize release wording and merge into `main`. No release tag or main-branch publication is part of this preview preparation.

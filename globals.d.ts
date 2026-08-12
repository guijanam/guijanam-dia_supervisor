// Next 가 제공하는 타입 선언에는 '*.module.css'(CSS Modules)만 있고
// 전역 CSS 의 부수 효과 import 는 선언이 없다. 그래서 app/layout.tsx 의
// `import "./globals.css"` 가 편집기에서 ts(2882) 로 표시된다.
// 빌드에는 영향이 없지만 편집기 오류를 없애기 위해 명시적으로 선언한다.
declare module "*.css";

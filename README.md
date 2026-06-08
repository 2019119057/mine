# MC Java Host

사용자 PC에서 Minecraft Java Edition 서버를 무료로 열 수 있게 도와주는 로컬 호스트 앱입니다.

브라우저 패널로도 실행할 수 있고, Electron을 설치하면 Windows 프로그램 형태로도 실행할 수 있습니다.

## 실행

개발용 웹 패널:

```powershell
npm run dev
```

브라우저에서 `http://127.0.0.1:3417`로 접속합니다.

프로그램 형태:

```powershell
npm install
npm run desktop
```

Windows 휴대용 실행 파일 빌드:

```powershell
npm run build:win
```

빌드 결과는 `dist` 폴더에 생성됩니다.

## 공개 서버 열기

1. Java 21 이상을 설치합니다.
2. 앱에서 Minecraft 버전, RAM, 포트, 최대 인원을 설정합니다.
3. Minecraft EULA에 동의합니다.
4. `서버 jar 받기`를 누릅니다.
5. `시작`을 누릅니다.
6. 외부 친구 접속이 필요하면 playit.gg 에이전트를 설치하고 `playit 켜기`를 누릅니다.
7. 앱에 표시되는 공개 주소를 친구에게 보냅니다.

## 기능

- 최신 release 또는 선택한 Java 서버 버전 다운로드
- Mojang EULA 동의 후 서버 시작
- 서버 시작/중지
- 실시간 로그 확인
- 콘솔 명령어 입력
- `server.properties` 주요 설정 저장
- LAN 접속 주소 표시
- playit.gg 에이전트 실행/중지와 공개 주소 표시
- 월드 폴더 백업

## 참고

일반 공유기 포트포워딩은 통신사 CGNAT, 공유기 설정, 방화벽 때문에 실패할 수 있습니다. 그래서 이 앱은 포트포워딩 없이 공개 주소를 만들 수 있는 playit.gg 연동을 우선 흐름으로 둡니다.

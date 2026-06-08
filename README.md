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
6. `공인 IP 확인`을 눌러 친구에게 줄 주소를 만듭니다.
7. `방화벽 허용`과 `자동 포트 열기`를 누릅니다.
8. 앱에 표시되는 `공인IP:포트` 주소를 친구에게 보냅니다.
9. 서버 공개를 끝낼 때는 `포트 닫기`와 `방화벽 닫기`를 누릅니다.

## 기능

- 최신 release 또는 선택한 Java 서버 버전 다운로드
- Mojang EULA 동의 후 서버 시작
- 서버 시작/중지
- 실시간 로그 확인
- 콘솔 명령어 입력
- `server.properties` 주요 설정 저장
- LAN 접속 주소 표시
- 공인 IP 기반 직접 공개 주소 표시
- UPnP/NAT-PMP 자동 포트포워딩
- Windows 방화벽 허용 규칙 추가
- Windows 방화벽 허용 규칙 삭제
- 월드 폴더 백업

## 참고

직접 공개는 공유기와 통신사 환경에 따라 실패할 수 있습니다. 공유기 UPnP가 꺼져 있거나, 이중 공유기/원룸망/학교망/통신사 CGNAT 환경이면 `공인IP:포트` 주소가 만들어져도 외부 접속이 되지 않을 수 있습니다.

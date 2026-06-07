# Minecraft Java Host

Windows에서 Minecraft Java Edition 서버를 로컬로 관리하는 작은 웹 앱입니다.

## 실행

```powershell
npm start
```

브라우저에서 `http://localhost:3417`로 접속합니다.

## 기능

- 최신 release 또는 선택한 Java 서버 버전 다운로드
- Mojang EULA 동의 후 서버 시작
- 서버 시작/중지
- 실시간 로그 확인
- 콘솔 명령어 입력
- `server.properties` 주요 설정 저장
- LAN 접속 주소 표시
- 월드 폴더 백업

## 참고

친구가 외부 인터넷에서 접속하려면 공유기 포트포워딩, VPN, 또는 터널링 서비스가 필요할 수 있습니다. 기본 서버 포트는 `25565`입니다.

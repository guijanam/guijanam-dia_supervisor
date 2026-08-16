import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 개발 중 휴대폰·태블릿에서 접속할 때 쓰는 LAN 주소.
  // DHCP 로 주소가 바뀌면 여기에 추가해야 /_next/* 요청이 차단되지 않는다.
  allowedDevOrigins: ["192.168.1.22", "192.168.1.122", "192.168.1.183"],
};

export default nextConfig;

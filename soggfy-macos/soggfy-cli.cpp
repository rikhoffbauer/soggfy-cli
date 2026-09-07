#include <iostream>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cstring>
#include <cstdlib>

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: soggfy-cli <command> [args...]\n";
        std::cerr << "Example: soggfy-cli set_track 4PTG3Z6ehGkBFwjybzWkR8\n";
        return 1;
    }

    std::ostringstream command;
    for (int i = 1; i < argc; ++i) {
        if (i > 1) command << ' ';
        command << argv[i];
    }
    const std::string payload = command.str();

    int sock = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sock < 0) {
        std::perror("socket");
        return 1;
    }

    sockaddr_un serv_addr{};
    serv_addr.sun_family = AF_UNIX;
    const char* env_socket = std::getenv("SOGGFY_SOCKET_PATH");
    const char* socket_path = env_socket ? env_socket : "/tmp/soggfy.sock";
    std::strncpy(serv_addr.sun_path, socket_path, sizeof(serv_addr.sun_path) - 1);

    if (connect(sock, reinterpret_cast<sockaddr*>(&serv_addr), sizeof(serv_addr)) < 0) {
        std::cerr << "Connection failed for " << socket_path << ". Is Spotify running with payload?\n";
        close(sock);
        return 1;
    }

    if (send(sock, payload.c_str(), payload.size(), 0) < 0) {
        std::perror("send");
        close(sock);
        return 1;
    }

    char buffer[4096] = {0};
    ssize_t n = read(sock, buffer, sizeof(buffer) - 1);
    if (n < 0) {
        std::perror("read");
        close(sock);
        return 1;
    }
    if (n > 0) std::cout << std::string(buffer, static_cast<size_t>(n)) << '\n';

    close(sock);
    return 0;
}

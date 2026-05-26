using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

internal static class Live2DStudioLauncher
{
    private const int DefaultPort = 3288;
    private const string Live2DPath = "/live2d-studio/";

    private static readonly CancellationTokenSource Shutdown = new CancellationTokenSource();
    private static TcpListener listener;

    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            var repoRoot = NormalizeBaseDir(AppDomain.CurrentDomain.BaseDirectory);
            if (!EnsureBuilt(repoRoot))
            {
                return 1;
            }

            var preferredPort = ParsePort(args, DefaultPort);
            var port = FindAvailablePort(preferredPort);
            var url = "http://127.0.0.1:" + port + Live2DPath;

            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();

            Console.CancelKeyPress += OnCancelKeyPress;
            AppDomain.CurrentDomain.ProcessExit += OnProcessExit;

            Console.WriteLine("Live2D Studio launcher started.");
            Console.WriteLine("Root: " + repoRoot);
            Console.WriteLine("Open: " + url);
            Console.WriteLine("Press Ctrl+C to stop.");

            if (!HasFlag(args, "--no-browser"))
            {
                TryOpenBrowser(url);
            }
            RunServer(repoRoot);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            return 1;
        }
        finally
        {
            StopServer();
        }
    }

    private static string NormalizeBaseDir(string baseDir)
    {
        return baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static int ParsePort(string[] args, int fallback)
    {
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i] ?? string.Empty;
            if (arg.StartsWith("--port=", StringComparison.OrdinalIgnoreCase))
            {
                int value;
                if (int.TryParse(arg.Substring("--port=".Length), out value))
                {
                    return value;
                }
            }

            if (string.Equals(arg, "--port", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
            {
                int value;
                if (int.TryParse(args[i + 1], out value))
                {
                    return value;
                }
            }
        }

        return fallback;
    }


    private static bool HasFlag(string[] args, string flag)
    {
        foreach (var arg in args)
        {
            if (string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
    private static int FindAvailablePort(int preferredPort)
    {
        for (var port = preferredPort; port < preferredPort + 32 && port <= 65535; port++)
        {
            if (IsPortAvailable(port))
            {
                return port;
            }
        }

        throw new InvalidOperationException("Unable to find a free port near " + preferredPort + ".");
    }

    private static bool IsPortAvailable(int port)
    {
        TcpListener probe = null;
        try
        {
            probe = new TcpListener(IPAddress.Loopback, port);
            probe.Start();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
        finally
        {
            if (probe != null)
            {
                probe.Stop();
            }
        }
    }

    private static bool EnsureBuilt(string repoRoot)
    {
        var builtIndex = Path.Combine(repoRoot, "dist", "live2d-studio", "index.html");
        if (File.Exists(builtIndex))
        {
            return true;
        }

        Console.WriteLine("Missing dist/live2d-studio/index.html, trying to build it first...");
        var nodeDir = FindNodeDirectory(repoRoot);
        if (string.IsNullOrEmpty(nodeDir))
        {
            Console.Error.WriteLine("Build output is missing and Node.js was not found.");
            Console.Error.WriteLine("Run `npm install` and `npm run build:live2d-studio` in the repo root first.");
            return false;
        }

        var build = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe"),
            Arguments = "/c npm run build:live2d-studio",
            WorkingDirectory = repoRoot,
            UseShellExecute = false,
            CreateNoWindow = false
        };
        build.EnvironmentVariables["PATH"] = nodeDir + Path.PathSeparator + build.EnvironmentVariables["PATH"];

        using (var process = Process.Start(build))
        {
            process.WaitForExit();
            if (process.ExitCode != 0)
            {
                Console.Error.WriteLine("Live2D Studio build failed.");
                return false;
            }
        }

        if (!File.Exists(builtIndex))
        {
            Console.Error.WriteLine("Build finished, but dist/live2d-studio/index.html is still missing.");
            return false;
        }

        return true;
    }

    private static string FindNodeDirectory(string repoRoot)
    {
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(repoRoot, "..", ".codex_tmp", "node-v20.19.0-win-x64")),
            Path.GetFullPath(Path.Combine(repoRoot, "..", ".codex_tmp", "node-v22.11.0-win-x64"))
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(Path.Combine(candidate, "node.exe")))
            {
                return candidate;
            }
        }

        var pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var pathEntry in pathValue.Split(new[] { Path.PathSeparator }, StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = pathEntry.Trim('"');
            if (File.Exists(Path.Combine(trimmed, "node.exe")) && File.Exists(Path.Combine(trimmed, "npm.cmd")))
            {
                return trimmed;
            }
        }

        return string.Empty;
    }

    private static void RunServer(string repoRoot)
    {
        while (!Shutdown.IsCancellationRequested)
        {
            if (!listener.Pending())
            {
                Thread.Sleep(20);
                continue;
            }

            TcpClient client = null;
            try
            {
                client = listener.AcceptTcpClient();
            }
            catch (SocketException)
            {
                if (Shutdown.IsCancellationRequested)
                {
                    break;
                }

                continue;
            }
            catch (ObjectDisposedException)
            {
                break;
            }

            if (client != null)
            {
                var rootCopy = repoRoot;
                ThreadPool.QueueUserWorkItem(_ => HandleClient(client, rootCopy));
            }
        }
    }

    private static void HandleClient(TcpClient client, string repoRoot)
    {
        using (client)
        using (var stream = client.GetStream())
        using (var reader = new StreamReader(stream, Encoding.ASCII, false, 8192, true))
        {
            var requestLine = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(requestLine))
            {
                return;
            }

            var parts = requestLine.Split(' ');
            if (parts.Length < 2)
            {
                WritePlainResponse(stream, 400, "Bad Request", "text/plain; charset=utf-8", "Bad Request", false);
                return;
            }

            var method = parts[0].Trim().ToUpperInvariant();
            var rawTarget = parts[1].Trim();

            while (!string.IsNullOrEmpty(reader.ReadLine()))
            {
                // skip headers
            }

            if (method != "GET" && method != "HEAD")
            {
                WritePlainResponse(stream, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Method Not Allowed", false);
                return;
            }

            var path = rawTarget;
            var queryIndex = path.IndexOf('?');
            if (queryIndex >= 0)
            {
                path = path.Substring(0, queryIndex);
            }
            path = Uri.UnescapeDataString(path);

            if (path == "/" || string.IsNullOrEmpty(path))
            {
                WriteRedirect(stream, "/live2d-studio/");
                return;
            }

            if (string.Equals(path, "/live2d-studio", StringComparison.OrdinalIgnoreCase))
            {
                WriteRedirect(stream, "/live2d-studio/");
                return;
            }

            var physicalPath = ResolvePhysicalPath(repoRoot, path);
            if (physicalPath == null)
            {
                WritePlainResponse(stream, 404, "Not Found", "text/plain; charset=utf-8", "Not Found", false);
                return;
            }

            if (!File.Exists(physicalPath))
            {
                if (IsLive2DRoute(path))
                {
                    physicalPath = Path.Combine(repoRoot, "dist", "live2d-studio", "index.html");
                }
                else if (Directory.Exists(physicalPath))
                {
                    var directoryIndex = Path.Combine(physicalPath, "index.html");
                    if (File.Exists(directoryIndex))
                    {
                        physicalPath = directoryIndex;
                    }
                }
            }

            if (!File.Exists(physicalPath))
            {
                WritePlainResponse(stream, 404, "Not Found", "text/plain; charset=utf-8", "Not Found", false);
                return;
            }

            WriteFileResponse(stream, physicalPath, method == "HEAD");
        }
    }

    private static bool IsLive2DRoute(string path)
    {
        return path.StartsWith("/live2d-studio/", StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolvePhysicalPath(string repoRoot, string requestPath)
    {
        var safePath = requestPath.TrimStart('/');
        if (safePath.StartsWith("live2d-studio/", StringComparison.OrdinalIgnoreCase))
        {
            safePath = "dist/" + safePath;
        }

        var combined = Path.GetFullPath(Path.Combine(repoRoot, safePath.Replace('/', Path.DirectorySeparatorChar)));
        var normalizedRoot = NormalizeBaseDir(repoRoot);
        if (!combined.StartsWith(normalizedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(combined, normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return combined;
    }

    private static void WriteRedirect(NetworkStream stream, string location)
    {
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 302 Found\r\n");
        headers.Append("Location: ").Append(location).Append("\r\n");
        headers.Append("Cache-Control: no-store\r\n");
        headers.Append("Connection: close\r\n\r\n");
        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
    }

    private static void WriteFileResponse(NetworkStream stream, string filePath, bool headOnly)
    {
        var bytes = File.ReadAllBytes(filePath);
        var contentType = GetContentType(filePath);
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 200 OK\r\n");
        headers.Append("Content-Type: ").Append(contentType).Append("\r\n");
        headers.Append("Content-Length: ").Append(bytes.Length).Append("\r\n");
        headers.Append("Cache-Control: ").Append(GetCacheControl(filePath)).Append("\r\n");
        headers.Append("Connection: close\r\n\r\n");

        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
        if (!headOnly)
        {
            WriteBytes(stream, bytes);
        }
    }

    private static void WritePlainResponse(NetworkStream stream, int statusCode, string statusText, string contentType, string body, bool headOnly)
    {
        var payload = Encoding.UTF8.GetBytes(body ?? string.Empty);
        var headers = new StringBuilder();
        headers.Append("HTTP/1.1 ").Append(statusCode).Append(' ').Append(statusText).Append("\r\n");
        headers.Append("Content-Type: ").Append(contentType).Append("\r\n");
        headers.Append("Content-Length: ").Append(payload.Length).Append("\r\n");
        headers.Append("Cache-Control: no-store\r\n");
        headers.Append("Connection: close\r\n\r\n");
        WriteBytes(stream, Encoding.ASCII.GetBytes(headers.ToString()));
        if (!headOnly)
        {
            WriteBytes(stream, payload);
        }
    }

    private static void WriteBytes(NetworkStream stream, byte[] bytes)
    {
        stream.Write(bytes, 0, bytes.Length);
        stream.Flush();
    }

    private static string GetContentType(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        switch (extension)
        {
            case ".html":
            case ".htm":
                return "text/html; charset=utf-8";
            case ".js":
            case ".mjs":
                return "application/javascript; charset=utf-8";
            case ".css":
                return "text/css; charset=utf-8";
            case ".json":
                return "application/json; charset=utf-8";
            case ".svg":
                return "image/svg+xml";
            case ".png":
                return "image/png";
            case ".jpg":
            case ".jpeg":
                return "image/jpeg";
            case ".gif":
                return "image/gif";
            case ".webp":
                return "image/webp";
            case ".ico":
                return "image/x-icon";
            case ".woff":
                return "font/woff";
            case ".woff2":
                return "font/woff2";
            case ".moc3":
            case ".bin":
                return "application/octet-stream";
            default:
                return "application/octet-stream";
        }
    }

    private static string GetCacheControl(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        if (extension == ".html")
        {
            return "no-store";
        }

        return "public, max-age=31536000, immutable";
    }

    private static void TryOpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine("Could not open the browser automatically: " + ex.Message);
        }
    }

    private static void OnCancelKeyPress(object sender, ConsoleCancelEventArgs e)
    {
        e.Cancel = true;
        Shutdown.Cancel();
        StopServer();
    }

    private static void OnProcessExit(object sender, EventArgs e)
    {
        Shutdown.Cancel();
        StopServer();
    }

    private static void StopServer()
    {
        var current = listener;
        listener = null;
        if (current != null)
        {
            try
            {
                current.Stop();
            }
            catch
            {
                // ignore shutdown errors
            }
        }
    }
}





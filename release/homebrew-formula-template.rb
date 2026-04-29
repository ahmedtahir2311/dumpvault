# Homebrew formula template for DumpVault.
#
# Placeholders are replaced by `scripts/render-homebrew-formula.sh`:
#   %VERSION%             — release version, e.g. "0.6.0" (no leading "v")
#   %SHA_DARWIN_ARM64%    — sha256 of dumpvault-darwin-arm64
#   %SHA_DARWIN_X64%      — sha256 of dumpvault-darwin-x64
#   %SHA_LINUX_ARM64%     — sha256 of dumpvault-linux-arm64
#   %SHA_LINUX_X64%       — sha256 of dumpvault-linux-x64
#
# Rendered output is committed to the homebrew-dumpvault tap repo as
# Formula/dumpvault.rb. See RELEASING.md for the workflow.
class Dumpvault < Formula
  desc "Cross-engine database backup tool"
  homepage "https://github.com/ahmedtahir2311/dumpvault"
  version "%VERSION%"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/ahmedtahir2311/dumpvault/releases/download/v%VERSION%/dumpvault-darwin-arm64"
      sha256 "%SHA_DARWIN_ARM64%"

      def install
        bin.install "dumpvault-darwin-arm64" => "dumpvault"
      end
    end
    on_intel do
      url "https://github.com/ahmedtahir2311/dumpvault/releases/download/v%VERSION%/dumpvault-darwin-x64"
      sha256 "%SHA_DARWIN_X64%"

      def install
        bin.install "dumpvault-darwin-x64" => "dumpvault"
      end
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/ahmedtahir2311/dumpvault/releases/download/v%VERSION%/dumpvault-linux-arm64"
      sha256 "%SHA_LINUX_ARM64%"

      def install
        bin.install "dumpvault-linux-arm64" => "dumpvault"
      end
    end
    on_intel do
      url "https://github.com/ahmedtahir2311/dumpvault/releases/download/v%VERSION%/dumpvault-linux-x64"
      sha256 "%SHA_LINUX_X64%"

      def install
        bin.install "dumpvault-linux-x64" => "dumpvault"
      end
    end
  end

  # Recommend Postgres client tools for the most common adapter.
  depends_on "libpq" => :recommended

  test do
    assert_match version.to_s, shell_output("#{bin}/dumpvault --version")
    assert_match "Cross-engine database backup tool", shell_output("#{bin}/dumpvault --help")
  end
end

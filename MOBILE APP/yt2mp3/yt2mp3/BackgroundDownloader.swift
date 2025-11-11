import Foundation

protocol BackgroundDownloaderDelegate: AnyObject {
    func didFinishDownload(tempURL: URL, suggestedFilename: String?)
    func didFailDownload(error: Error)
}

final class BackgroundDownloader: NSObject, URLSessionDownloadDelegate {
    weak var delegate: BackgroundDownloaderDelegate?

    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.allowsExpensiveNetworkAccess = true
        cfg.allowsConstrainedNetworkAccess = true
        return URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
    }()

    func start(url: URL) {
        let task = session.downloadTask(with: url)
        task.resume()
    }

    // MARK: URLSessionDownloadDelegate
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let suggested = (downloadTask.response as? HTTPURLResponse)
            .flatMap { http -> String? in
                guard let disp = http.value(forHTTPHeaderField: "Content-Disposition") else { return nil }
                // naive parse for filename=
                let pattern = #"filename\*?=UTF-8''([^;]+)|filename="([^"]+)""#
                if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                    let s = disp as NSString
                    if let m = regex.firstMatch(in: disp, options: [], range: NSRange(location: 0, length: s.length)) {
                        for i in 1..<m.numberOfRanges {
                            let r = m.range(at: i)
                            if r.location != NSNotFound { return s.substring(with: r).removingPercentEncoding }
                        }
                    }
                }
                return nil
            }
        delegate?.didFinishDownload(tempURL: location, suggestedFilename: suggested)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error { delegate?.didFailDownload(error: error) }
    }
}

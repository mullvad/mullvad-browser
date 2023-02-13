export class AboutMullvadBrowserChild extends JSWindowActorChild {
  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded":
        this.sendQuery("AboutMullvadBrowser:GetUpdateData").then(data => {
          const updateEvent = new this.contentWindow.CustomEvent("UpdateData", {
            detail: Cu.cloneInto(data, this.contentWindow),
          });
          this.contentWindow.dispatchEvent(updateEvent);
        });
        break;
    }
  }
}

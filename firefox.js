require("dotenv").config();
const cors = require("cors");
const express = require("express");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const { Builder, By, Key, until } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const options = new firefox.Options();
const app = express();

app.use(cors());
app.use(express.json());

options.addArguments("--start-maximized");

async function pauseForCaptcha() {
  console.log(
    "Please solve the CAPTCHA manually and then press Enter to continue..."
  );
  await new Promise((resolve) => process.stdin.once("data", resolve));
}

async function scrapLinkedIn(url) {
  let driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build();

  const leads = [];
  try {
    const email = process.env.LINKEDIN_EMAIL;
    const password = process.env.LINKEDIN_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "LinkedIn credentials are not set in the environment variables"
      );
    }

    await driver.get("https://www.linkedin.com/login");
    console.log("Navigated to LinkedIn login page.");
    await driver.findElement(By.id("username")).sendKeys(email);
    console.log("Entered email.");
    await driver.findElement(By.id("password")).sendKeys(password, Key.RETURN);
    console.log("Entered password and submitted.");
    await driver.wait(until.urlContains("/feed"), 40000);
    console.log("Logged in and navigated to feed.");

    let captchaPresent = await driver.findElements(By.css("div.g-recaptcha"));
    if (captchaPresent.length > 0) {
      console.log("CAPTCHA detected. Pausing for manual resolution...");
      await pauseForCaptcha();
    }

    await driver.get(url);
    await driver.wait(
      until.elementLocated(By.css(".reusable-search__result-container")),
      50000
    );

    let userCount = 0;
    const desiredUserCount = 3;
    let currentPage = 1;

    while (userCount < desiredUserCount) {
      console.log(`Scraping page ${currentPage}...`);
      let results = await driver.findElements(
        By.css(".reusable-search__result-container")
      );

      for (let i = 0; i < results.length; i++) {
        if (userCount >= desiredUserCount) break;
        let result = results[i];
        try {
          let name = await result
            .findElement(By.css(".entity-result__title-text"))
            .getText();
          let title = await result
            .findElement(By.css(".entity-result__primary-subtitle"))
            .getText();
          let location = await result
            .findElement(By.css(".entity-result__secondary-subtitle"))
            .getText();

          console.log(`Name: ${name}`);
          console.log(`Title: ${title}`);
          console.log(`Location: ${location}`);
          console.log("---");

          let profileLink = await result.findElement(
            By.css("a.app-aware-link")
          );
          await profileLink.click();
          await driver.wait(until.urlContains("/in/"), 20000);

          let experienceSection = await driver.findElement(
            By.css(".artdeco-card")
          );
          await driver.executeScript(
            "arguments[0].scrollIntoView(true);",
            experienceSection
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));

          let experienceDetails = await driver.findElements(
            By.css(".artdeco-card .artdeco-list__item")
          );
          console.log("----------------", experienceDetails.length);

          let companyName = "Not Found";
          let totalExperience = "Not Found";
          if (experienceDetails.length > 0) {
            let firstExperience = experienceDetails[0];
            let companyNameElement = await firstExperience.findElement(
              By.css("span.t-14.t-normal span[aria-hidden='true']")
            );
            companyName = await companyNameElement.getText();
            let totalExperienceElement = await firstExperience.findElement(
              By.css("span.pvs-entity__caption-wrapper + span")
            );
            totalExperience = await totalExperienceElement.getText();
          }

          console.log(`Name: ${name}`);
          console.log(`Title: ${title}`);
          console.log(`Location: ${location}`);
          console.log(`Company Name: ${companyName}`);
          console.log(`Total Experience: ${totalExperience}`);
          console.log("---");

          if (companyName !== "Not Found" && totalExperience !== "Not Found") {
            leads.push({
              name,
              title,
              location,
              companyName,
              totalExperience,
            });
            userCount++;
          }

          await driver.navigate().back();
          await driver.wait(
            until.elementLocated(By.css(".reusable-search__result-container")),
            40000
          );
          results = await driver.findElements(
            By.css(".reusable-search__result-container")
          );
        } catch (err) {
          console.error(`Error scraping profile: ${err}`);
          await driver.navigate().back();
          await driver.wait(
            until.elementLocated(By.css(".reusable-search__result-container")),
            20000
          );
          results = await driver.findElements(
            By.css(".reusable-search__result-container")
          );
        }
      }

      await driver.executeScript(
        "window.scrollTo(0, document.body.scrollHeight);"
      );
      await new Promise((resolve) => setTimeout(resolve, 10000));

      try {
        let nextButton = await driver.findElement(
          By.css("button.artdeco-pagination__button--next")
        );
        await nextButton.click();
      } catch (err) {
        console.log("No more pages available or pagination button not found.");
        break;
      }

      await driver.wait(
        until.elementLocated(By.css(".reusable-search__result-container")),
        20000
      );
      currentPage++;
    }

    console.log(`Total users scraped: ${userCount}`);
    console.log("hfsashays", leads);

    const csvWriterInstance = createCsvWriter({
      path: "linkedin_leads.csv",
      header: [
        { id: "name", title: "Name" },
        { id: "title", title: "Title" },
        { id: "location", title: "Location" },
        { id: "companyName", title: "Company Name" },
        { id: "totalExperience", title: "Total Experience" },
      ],
    });
    await csvWriterInstance.writeRecords(leads);
    console.log("Data successfully written to linkedin_leads.csv");
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    await driver.quit();
  }
}

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  console.log(url);
  if (!url) {
    return res.status(400).send("URL is required.");
  }
  try {
    await scrapLinkedIn(url);
    res.json({ message: "Scraping completed" });
  } catch (error) {
    res.status(500).json({ error: "Failed to scrape" });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
